import type {
  FundingInfo,
  Liquidation,
  OpenInterest,
  OrderBook,
  ServerMessage,
  Stats24h,
  Symbol,
  Trade,
} from '@vitalsync/shared';
import { PRICE_BUFFER_SIZE } from './config';

export interface PricePoint {
  t: number;
  p: number;
}

/**
 * Ring buffer de puntos de precio. Append O(1), sin realojar arrays.
 * El gráfico lo lee directamente en su bucle requestAnimationFrame.
 */
class PriceRing {
  private times: Float64Array;
  private prices: Float64Array;
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.times = new Float64Array(capacity);
    this.prices = new Float64Array(capacity);
  }

  push(t: number, p: number): void {
    this.times[this.head] = t;
    this.prices[this.head] = p;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Recorre los puntos dentro de [fromT, +inf) en orden cronológico. */
  forEachSince(fromT: number, fn: (t: number, p: number) => void): void {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      if (this.times[idx] >= fromT) fn(this.times[idx], this.prices[idx]);
    }
  }

  get size(): number {
    return this.count;
  }

  last(): PricePoint | null {
    if (this.count === 0) return null;
    const idx = (this.head - 1 + this.capacity) % this.capacity;
    return { t: this.times[idx], p: this.prices[idx] };
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }
}

/** Vista de baja frecuencia consumida por React (paneles numéricos). */
export interface DisplaySnapshot {
  symbol: Symbol;
  connected: boolean;
  live: boolean;
  price: number;
  priceDirection: 1 | 0 | -1;
  funding: FundingInfo;
  openInterest: OpenInterest;
  stats: Stats24h;
  version: number;
}

const EMPTY_STATS: Stats24h = {
  high: 0,
  low: 0,
  changePercent: 0,
  quoteVolume: 0,
  volume: 0,
};

/**
 * Store de mercado: única fuente de verdad en el cliente.
 *
 * Diseño de rendimiento:
 *  - Los datos crudos de alta frecuencia (precio, libro) se mutan en sitio y se
 *    leen directamente desde los componentes canvas en su bucle rAF.
 *  - React solo se entera mediante un snapshot reconstruido a baja frecuencia
 *    (~6-7 fps), evitando tormentas de re-render.
 */
export class MarketStore {
  readonly priceRing = new PriceRing(PRICE_BUFFER_SIZE);

  symbol: Symbol;
  connected = false;
  live = false;
  price = 0;
  prevPrice = 0;
  priceDirection: 1 | 0 | -1 = 0;
  funding: FundingInfo = { markPrice: 0, fundingRate: 0, nextFundingTime: 0 };
  openInterest: OpenInterest = { openInterest: 0, openInterestValue: 0, t: 0 };
  stats: Stats24h = { ...EMPTY_STATS };
  book: OrderBook = { bids: [], asks: [], lastUpdateId: 0 };

  trades: Trade[] = [];
  liquidations: Liquidation[] = [];
  /** Liquidaciones nuevas aún no renderizadas como marcador en el gráfico. */
  pendingLiquidationMarkers: Liquidation[] = [];

  private listeners = new Set<() => void>();
  private snapshot: DisplaySnapshot;
  private version = 0;
  private dirty = false;
  private notifyTimer: ReturnType<typeof setInterval> | null = null;

  constructor(symbol: Symbol) {
    this.symbol = symbol;
    this.snapshot = this.buildSnapshot();
  }

  // ---- API para React (useSyncExternalStore) ----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DisplaySnapshot => this.snapshot;

  /** Arranca el bucle de notificación throttled a React. */
  startNotifyLoop(intervalMs = 150): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setInterval(() => {
      if (!this.dirty) return;
      this.dirty = false;
      this.snapshot = this.buildSnapshot();
      this.listeners.forEach((l) => l());
    }, intervalMs);
  }

  stopNotifyLoop(): void {
    if (this.notifyTimer) clearInterval(this.notifyTimer);
    this.notifyTimer = null;
  }

  private buildSnapshot(): DisplaySnapshot {
    return {
      symbol: this.symbol,
      connected: this.connected,
      live: this.live,
      price: this.price,
      priceDirection: this.priceDirection,
      funding: this.funding,
      openInterest: this.openInterest,
      stats: this.stats,
      version: ++this.version,
    };
  }

  private markDirty(): void {
    this.dirty = true;
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.markDirty();
  }

  /** Cambia de símbolo y limpia el estado de mercado. */
  reset(symbol: Symbol): void {
    this.symbol = symbol;
    this.price = 0;
    this.prevPrice = 0;
    this.priceDirection = 0;
    this.priceRing.clear();
    this.trades = [];
    this.liquidations = [];
    this.pendingLiquidationMarkers = [];
    this.book = { bids: [], asks: [], lastUpdateId: 0 };
    this.stats = { ...EMPTY_STATS };
    this.markDirty();
  }

  private applyPrice(p: number, t: number): void {
    if (p <= 0) return;
    this.prevPrice = this.price || p;
    this.price = p;
    this.priceDirection = p > this.prevPrice ? 1 : p < this.prevPrice ? -1 : this.priceDirection;
    this.priceRing.push(t, p);
  }

  /** Procesa un mensaje del servidor. */
  apply(msg: ServerMessage): void {
    switch (msg.type) {
      case 'snapshot': {
        if (msg.symbol !== this.symbol) return;
        this.live = msg.live;
        this.funding = msg.funding;
        this.openInterest = msg.openInterest;
        this.stats = msg.stats;
        this.book = msg.book;
        this.trades = msg.recentTrades.slice();
        this.liquidations = msg.recentLiquidations.slice();
        const seedT = Date.now();
        // Sembramos el gráfico con las operaciones recientes para que no arranque vacío.
        msg.recentTrades.forEach((tr) => this.priceRing.push(tr.t, tr.p));
        if (msg.price > 0) this.applyPrice(msg.price, seedT);
        this.markDirty();
        break;
      }
      case 'trade': {
        if (msg.symbol !== this.symbol) return;
        this.applyPrice(msg.trade.p, msg.trade.t);
        this.trades.push(msg.trade);
        if (this.trades.length > 80) this.trades.shift();
        this.markDirty();
        break;
      }
      case 'book': {
        if (msg.symbol !== this.symbol) return;
        this.book = msg.book;
        break;
      }
      case 'funding': {
        if (msg.symbol !== this.symbol) return;
        this.funding = msg.funding;
        if (this.price === 0) this.applyPrice(msg.funding.markPrice, Date.now());
        this.markDirty();
        break;
      }
      case 'oi': {
        if (msg.symbol !== this.symbol) return;
        this.openInterest = msg.openInterest;
        this.markDirty();
        break;
      }
      case 'stats': {
        if (msg.symbol !== this.symbol) return;
        this.stats = msg.stats;
        if (msg.price > 0) this.applyPrice(msg.price, Date.now());
        this.markDirty();
        break;
      }
      case 'liquidation': {
        if (msg.symbol !== this.symbol) return;
        this.liquidations.unshift(msg.liquidation);
        if (this.liquidations.length > 40) this.liquidations.pop();
        this.pendingLiquidationMarkers.push(msg.liquidation);
        this.markDirty();
        break;
      }
    }
  }
}
