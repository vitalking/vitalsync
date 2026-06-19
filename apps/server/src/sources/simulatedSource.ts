import type { BookLevel, Symbol } from '@vitalsync/shared';
import { config } from '../config.js';
import { TypedEmitter, type DataSource } from './types.js';

const BASE_PRICE: Record<string, number> = {
  BTCUSDT: 67500,
  ETHUSDT: 3500,
  SOLUSDT: 165,
  BNBUSDT: 600,
  XRPUSDT: 0.62,
};

/**
 * Fuente sintética que reproduce el comportamiento de un mercado real:
 * random-walk con micro-tendencias, libro de órdenes coherente alrededor del
 * precio, liquidaciones ocasionales, funding y open interest.
 *
 * Sirve para demos y para validar todo el pipeline en entornos donde Binance
 * está geo-bloqueado (HTTP 451).
 */
export class SimulatedSource extends TypedEmitter implements DataSource {
  readonly live = false;
  private price: number;
  private drift = 0;
  private dayOpen: number;
  private high: number;
  private low: number;
  private quoteVolume = 0;
  private volume = 0;
  private openInterestBase: number;
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;

  constructor(readonly symbol: Symbol) {
    super();
    this.price = BASE_PRICE[symbol] ?? 100;
    this.dayOpen = this.price * (1 + (Math.random() - 0.5) * 0.04);
    this.high = Math.max(this.price, this.dayOpen);
    this.low = Math.min(this.price, this.dayOpen);
    this.openInterestBase = (this.price > 1000 ? 4e5 : 5e7) * (0.8 + Math.random() * 0.4);
  }

  async start(): Promise<void> {
    // Pequeño retardo para emular el handshake.
    await new Promise((r) => setTimeout(r, 50));
    this.loopTrades();
    this.timers.push(setInterval(() => this.emitBook(), config.bookBroadcastIntervalMs));
    this.timers.push(setInterval(() => this.emitFunding(), 1000));
    this.timers.push(setInterval(() => this.emitOi(), config.oiPollIntervalMs));
    this.timers.push(setInterval(() => this.emitStats(), 1000));
    this.timers.push(setInterval(() => this.maybeLiquidation(), 1500));
    this.emitFunding();
    this.emitOi();
    this.emitStats();
    this.emitTyped('ready');
  }

  stop(): void {
    this.stopped = true;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
  }

  // -------------------------------------------------------------------------

  private step(): void {
    // Micro-tendencia que se desvanece + ruido.
    this.drift += (Math.random() - 0.5) * 0.00008;
    this.drift *= 0.96;
    const change = this.drift + (Math.random() - 0.5) * 0.00035;
    this.price *= 1 + change;
    this.high = Math.max(this.high, this.price);
    this.low = Math.min(this.low, this.price);
  }

  private loopTrades(): void {
    if (this.stopped) return;
    this.step();
    const qty = this.randomQty();
    const isBuyerMaker = Math.random() > 0.5 + this.drift * 400;
    this.quoteVolume += qty * this.price;
    this.volume += qty;
    this.emitTyped('trade', {
      p: round(this.price, this.tickDecimals()),
      q: qty,
      m: isBuyerMaker,
      t: Date.now(),
    });
    // Frecuencia variable de operaciones (ráfagas).
    const next = 60 + Math.random() * 280;
    this.timers.push(setTimeout(() => this.loopTrades(), next) as unknown as NodeJS.Timeout);
  }

  private emitBook(): void {
    const decimals = this.tickDecimals();
    const tick = this.tickSize();
    const bids: BookLevel[] = [];
    const asks: BookLevel[] = [];
    const spread = tick * (1 + Math.floor(Math.random() * 2));
    let bidP = this.price - spread / 2;
    let askP = this.price + spread / 2;
    for (let i = 0; i < config.bookDepth; i++) {
      const depthFactor = 1 - i / (config.bookDepth * 1.5);
      const baseQty = (this.price > 1000 ? 0.5 : 2000) * depthFactor;
      bids.push([round(bidP, decimals), round(baseQty * (0.3 + Math.random() * 1.7), 3)]);
      asks.push([round(askP, decimals), round(baseQty * (0.3 + Math.random() * 1.7), 3)]);
      bidP -= tick * (1 + Math.floor(Math.random() * 3));
      askP += tick * (1 + Math.floor(Math.random() * 3));
    }
    this.emitTyped('book', { bids, asks, lastUpdateId: Date.now() });
  }

  private emitFunding(): void {
    const fundingRate = 0.0001 + Math.sin(Date.now() / 3.6e6) * 0.0003 + (Math.random() - 0.5) * 0.00005;
    const now = Date.now();
    const eightHours = 8 * 3600 * 1000;
    const nextFundingTime = Math.ceil(now / eightHours) * eightHours;
    this.emitTyped('funding', {
      markPrice: round(this.price * (1 + (Math.random() - 0.5) * 0.0001), this.tickDecimals()),
      fundingRate: round(fundingRate, 7),
      nextFundingTime,
    });
  }

  private emitOi(): void {
    this.openInterestBase *= 1 + (Math.random() - 0.5) * 0.01;
    this.emitTyped('oi', {
      openInterest: round(this.openInterestBase, 2),
      openInterestValue: this.openInterestBase * this.price,
      t: Date.now(),
    });
  }

  private emitStats(): void {
    const changePercent = ((this.price - this.dayOpen) / this.dayOpen) * 100;
    this.emitTyped(
      'stats',
      {
        high: round(this.high, this.tickDecimals()),
        low: round(this.low, this.tickDecimals()),
        changePercent: round(changePercent, 2),
        quoteVolume: this.quoteVolume + this.openInterestBase * this.price * 0.5,
        volume: this.volume + this.openInterestBase * 0.5,
      },
      round(this.price, this.tickDecimals()),
    );
  }

  private maybeLiquidation(): void {
    if (Math.random() > 0.45) return;
    const side: 'BUY' | 'SELL' = Math.random() > 0.5 ? 'BUY' : 'SELL';
    const qty = this.randomQty() * (5 + Math.random() * 60);
    const price = round(this.price * (1 + (Math.random() - 0.5) * 0.001), this.tickDecimals());
    this.emitTyped('liquidation', {
      side,
      price,
      qty: round(qty, 3),
      value: price * qty,
      t: Date.now(),
    });
  }

  private randomQty(): number {
    const big = this.price > 1000 ? 0.05 : 50;
    return round(big * (0.1 + Math.random() * Math.random() * 8), 3);
  }

  private tickSize(): number {
    if (this.price >= 10000) return 0.1;
    if (this.price >= 100) return 0.01;
    if (this.price >= 1) return 0.001;
    return 0.0001;
  }

  private tickDecimals(): number {
    if (this.price >= 10000) return 1;
    if (this.price >= 100) return 2;
    if (this.price >= 1) return 3;
    return 4;
  }
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
