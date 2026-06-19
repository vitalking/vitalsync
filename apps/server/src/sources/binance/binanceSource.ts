import WebSocket from 'ws';
import type { Symbol } from '@vitalsync/shared';
import { config } from '../../config.js';
import { log } from '../../logger.js';
import { TypedEmitter, type DataSource } from '../types.js';
import { OrderBookManager } from './orderBookManager.js';

/**
 * Fuente de datos real conectada a Binance USD-M Futures mediante un único
 * "combined stream" por símbolo: aggTrade, markPrice, depth, forceOrder y ticker.
 * Mantiene el order book local y hace polling del Open Interest por REST.
 */
export class BinanceSource extends TypedEmitter implements DataSource {
  readonly live = true;
  private ws: WebSocket | null = null;
  private book: OrderBookManager;
  private oiTimer: NodeJS.Timeout | null = null;
  private bookEmitTimer: NodeJS.Timeout | null = null;
  private lastPrice = 0;
  private stopped = false;
  private reconnectDelay = 1000;

  constructor(readonly symbol: Symbol) {
    super();
    const lower = symbol.toLowerCase();
    this.book = new OrderBookManager(symbol, () => this.fetchDepthSnapshot(lower));
  }

  async start(): Promise<void> {
    await this.connectAndSync();
    this.startOiPolling();
    this.startBookEmitter();
  }

  stop(): void {
    this.stopped = true;
    if (this.oiTimer) clearInterval(this.oiTimer);
    if (this.bookEmitTimer) clearInterval(this.bookEmitTimer);
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
  }

  // -------------------------------------------------------------------------

  private streamUrl(): string {
    const s = this.symbol.toLowerCase();
    const streams = [
      `${s}@aggTrade`,
      `${s}@markPrice@1s`,
      `${s}@depth@100ms`,
      `${s}@forceOrder`,
      `${s}@ticker`,
    ].join('/');
    return `${config.binanceWsBase}/stream?streams=${streams}`;
  }

  private connectAndSync(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.ws?.close();
          reject(new Error(`Timeout conectando a Binance (${this.symbol})`));
        }
      }, config.binanceConnectTimeoutMs);

      this.ws = new WebSocket(this.streamUrl());

      this.ws.on('open', async () => {
        log.info(`[binance ${this.symbol}] WS abierto, sincronizando libro...`);
        this.book.reset();
        try {
          await this.book.sync();
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.reconnectDelay = 1000;
            this.emitTyped('ready');
            resolve();
          }
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(err as Error);
          }
        }
      });

      this.ws.on('message', (raw) => this.onMessage(raw));

      this.ws.on('error', (err) => {
        log.warn(`[binance ${this.symbol}] error WS:`, (err as Error).message);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err as Error);
        }
      });

      this.ws.on('close', () => {
        if (this.stopped) return;
        log.warn(`[binance ${this.symbol}] WS cerrado, reconectando en ${this.reconnectDelay}ms`);
        setTimeout(() => this.reconnect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      });
    });
  }

  private reconnect(): void {
    if (this.stopped) return;
    this.connectAndSync().catch((e) =>
      log.error(`[binance ${this.symbol}] reconexión falló:`, (e as Error).message),
    );
  }

  private onMessage(raw: WebSocket.RawData): void {
    let parsed: { stream: string; data: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const d = parsed.data;
    if (!d || typeof d !== 'object') return;

    switch (d.e) {
      case 'aggTrade':
        this.onTrade(d);
        break;
      case 'markPriceUpdate':
        this.onMarkPrice(d);
        break;
      case 'depthUpdate':
        this.book.onDiff({
          U: d.U as number,
          u: d.u as number,
          pu: d.pu as number,
          b: d.b as [string, string][],
          a: d.a as [string, string][],
        });
        break;
      case 'forceOrder':
        this.onLiquidation(d);
        break;
      case '24hrTicker':
        this.onTicker(d);
        break;
    }
  }

  private onTrade(d: Record<string, unknown>): void {
    const p = parseFloat(d.p as string);
    this.lastPrice = p;
    this.emitTyped('trade', {
      p,
      q: parseFloat(d.q as string),
      m: Boolean(d.m),
      t: (d.T as number) ?? Date.now(),
    });
  }

  private onMarkPrice(d: Record<string, unknown>): void {
    this.emitTyped('funding', {
      markPrice: parseFloat(d.p as string),
      fundingRate: parseFloat((d.r as string) ?? '0'),
      nextFundingTime: (d.T as number) ?? 0,
    });
  }

  private onLiquidation(d: Record<string, unknown>): void {
    const o = d.o as Record<string, unknown>;
    if (!o) return;
    const price = parseFloat((o.ap as string) ?? (o.p as string));
    const qty = parseFloat(o.q as string);
    this.emitTyped('liquidation', {
      side: o.S as 'BUY' | 'SELL',
      price,
      qty,
      value: price * qty,
      t: (o.T as number) ?? Date.now(),
    });
  }

  private onTicker(d: Record<string, unknown>): void {
    const price = parseFloat(d.c as string);
    if (price > 0) this.lastPrice = price;
    this.emitTyped(
      'stats',
      {
        high: parseFloat(d.h as string),
        low: parseFloat(d.l as string),
        changePercent: parseFloat(d.P as string),
        quoteVolume: parseFloat(d.q as string),
        volume: parseFloat(d.v as string),
      },
      price,
    );
  }

  // -------------------------------------------------------------------------

  private startBookEmitter(): void {
    // Emitimos el libro a intervalo fijo (el agregador también puede throttlear).
    this.bookEmitTimer = setInterval(() => {
      if (this.book.isSynced()) {
        this.emitTyped('book', this.book.snapshot(config.bookDepth));
      }
    }, config.bookBroadcastIntervalMs);
  }

  private startOiPolling(): void {
    const poll = async () => {
      try {
        const res = await fetch(
          `${config.binanceRestBase}/fapi/v1/openInterest?symbol=${this.symbol}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { openInterest: string };
        const oi = parseFloat(data.openInterest);
        this.emitTyped('oi', {
          openInterest: oi,
          openInterestValue: oi * (this.lastPrice || 0),
          t: Date.now(),
        });
      } catch (e) {
        log.debug(`[binance ${this.symbol}] OI poll error`, (e as Error).message);
      }
    };
    void poll();
    this.oiTimer = setInterval(poll, config.oiPollIntervalMs);
  }

  private async fetchDepthSnapshot(
    lowerSymbol: string,
  ): Promise<{ lastUpdateId: number; bids: [string, string][]; asks: [string, string][] }> {
    const res = await fetch(
      `${config.binanceRestBase}/fapi/v1/depth?symbol=${lowerSymbol.toUpperCase()}&limit=1000`,
    );
    if (!res.ok) {
      throw new Error(`Snapshot de profundidad falló: HTTP ${res.status}`);
    }
    return (await res.json()) as {
      lastUpdateId: number;
      bids: [string, string][];
      asks: [string, string][];
    };
  }
}
