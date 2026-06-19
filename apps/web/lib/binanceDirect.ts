import type { BookLevel, Symbol } from '@vitalsync/shared';
import type { MarketStore } from './marketStore';

const BINANCE_WS = 'wss://fstream.binance.com/stream';

/**
 * Fuente de datos DIRECTA a Binance desde el navegador (plan B / fallback).
 *
 * Si el servidor agregador no está disponible (p. ej. dormido en el plan
 * gratuito de Render, o caído), el frontend se conecta directamente a Binance
 * Futures —igual que hacía el MVP original— para que el dashboard siempre
 * muestre datos reales y fluidos. Reutiliza el mismo MarketStore alimentándolo
 * con los mismos mensajes que enviaría el servidor.
 *
 * Nota: el Open Interest no está disponible por esta vía (Binance no expone un
 * stream WS de OI por símbolo y su REST no permite CORS desde el navegador).
 */
export class BinanceDirectSource {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private store: MarketStore,
    private symbol: Symbol,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        /* noop */
      }
      this.ws = null;
    }
  }

  private url(): string {
    const s = this.symbol.toLowerCase();
    const streams = [
      `${s}@aggTrade`,
      `${s}@markPrice@1s`,
      `${s}@depth20@500ms`,
      `${s}@forceOrder`,
      `${s}@ticker`,
    ].join('/');
    return `${BINANCE_WS}?streams=${streams}`;
  }

  private connect(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.store.live = true;
      this.store.setConnected(true);
      // Snapshot sintético para reflejar "datos reales / en vivo" en la UI.
      this.store.apply({
        type: 'snapshot',
        symbol: this.symbol,
        price: 0,
        funding: { markPrice: 0, fundingRate: 0, nextFundingTime: 0 },
        openInterest: { openInterest: 0, openInterestValue: 0, t: 0 },
        stats: { high: 0, low: 0, changePercent: 0, quoteVolume: 0, volume: 0 },
        book: { bids: [], asks: [], lastUpdateId: 0 },
        recentTrades: [],
        recentLiquidations: [],
        live: true,
        serverTime: Date.now(),
      });
    };

    ws.onmessage = (e) => this.onMessage(e.data as string);

    ws.onclose = () => {
      this.store.setConnected(false);
      if (!this.stopped) this.scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 2500);
  }

  private onMessage(raw: string): void {
    let parsed: { data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const d = parsed.data;
    if (!d) return;

    switch (d.e) {
      case 'aggTrade': {
        this.store.apply({
          type: 'trade',
          symbol: this.symbol,
          trade: {
            p: parseFloat(d.p as string),
            q: parseFloat(d.q as string),
            m: Boolean(d.m),
            t: (d.T as number) ?? Date.now(),
          },
        });
        break;
      }
      case 'markPriceUpdate': {
        this.store.apply({
          type: 'funding',
          symbol: this.symbol,
          funding: {
            markPrice: parseFloat(d.p as string),
            fundingRate: parseFloat((d.r as string) ?? '0'),
            nextFundingTime: (d.T as number) ?? 0,
          },
        });
        break;
      }
      case 'depthUpdate': {
        const toLevels = (arr: unknown): BookLevel[] =>
          Array.isArray(arr)
            ? (arr as [string, string][]).map(
                ([p, q]) => [parseFloat(p), parseFloat(q)] as BookLevel,
              )
            : [];
        this.store.apply({
          type: 'book',
          symbol: this.symbol,
          book: {
            bids: toLevels(d.b),
            asks: toLevels(d.a),
            lastUpdateId: (d.u as number) ?? Date.now(),
          },
        });
        break;
      }
      case 'forceOrder': {
        const o = d.o as Record<string, unknown>;
        if (!o) break;
        const price = parseFloat((o.ap as string) ?? (o.p as string));
        const qty = parseFloat(o.q as string);
        this.store.apply({
          type: 'liquidation',
          symbol: this.symbol,
          liquidation: {
            side: o.S as 'BUY' | 'SELL',
            price,
            qty,
            value: price * qty,
            t: (o.T as number) ?? Date.now(),
          },
        });
        break;
      }
      case '24hrTicker': {
        this.store.apply({
          type: 'stats',
          symbol: this.symbol,
          stats: {
            high: parseFloat(d.h as string),
            low: parseFloat(d.l as string),
            changePercent: parseFloat(d.P as string),
            quoteVolume: parseFloat(d.q as string),
            volume: parseFloat(d.v as string),
          },
          price: parseFloat(d.c as string),
        });
        break;
      }
    }
  }
}
