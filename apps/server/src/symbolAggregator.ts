import { EventEmitter } from 'node:events';
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
import { config } from './config.js';
import { log } from './logger.js';
import type { DataSource } from './sources/types.js';
import { BinanceSource } from './sources/binance/binanceSource.js';
import { SimulatedSource } from './sources/simulatedSource.js';

/**
 * Agrega los datos de un símbolo a partir de una DataSource, mantiene el estado
 * vigente (para construir snapshots a clientes nuevos) y reemite cada cambio
 * como un ServerMessage mediante el evento 'message'.
 */
export class SymbolAggregator extends EventEmitter {
  private source: DataSource | null = null;
  private live = false;

  private price = 0;
  private funding: FundingInfo = { markPrice: 0, fundingRate: 0, nextFundingTime: 0 };
  private oi: OpenInterest = { openInterest: 0, openInterestValue: 0, t: 0 };
  private stats: Stats24h = { high: 0, low: 0, changePercent: 0, quoteVolume: 0, volume: 0 };
  private book: OrderBook = { bids: [], asks: [], lastUpdateId: 0 };
  private recentTrades: Trade[] = [];
  private recentLiquidations: Liquidation[] = [];
  private ready = false;

  constructor(readonly symbol: Symbol) {
    super();
  }

  isReady(): boolean {
    return this.ready;
  }

  isLive(): boolean {
    return this.live;
  }

  async start(): Promise<void> {
    const mode = config.sourceMode;
    if (mode === 'simulated') {
      await this.startSource(new SimulatedSource(this.symbol));
      return;
    }

    try {
      await this.startSource(new BinanceSource(this.symbol));
      log.info(`[${this.symbol}] usando datos REALES de Binance`);
    } catch (err) {
      if (mode === 'binance') {
        log.error(`[${this.symbol}] no se pudo conectar a Binance:`, (err as Error).message);
        throw err;
      }
      log.warn(
        `[${this.symbol}] Binance no disponible (${(err as Error).message}); usando datos SIMULADOS`,
      );
      await this.startSource(new SimulatedSource(this.symbol));
    }
  }

  stop(): void {
    this.source?.stop();
    this.source = null;
  }

  private async startSource(source: DataSource): Promise<void> {
    this.source = source;
    this.live = source.live;

    source.on('trade', (t) => this.onTrade(t));
    source.on('book', (b) => this.onBook(b));
    source.on('funding', (f) => this.onFunding(f));
    source.on('oi', (o) => this.onOi(o));
    source.on('stats', (s, p) => this.onStats(s, p));
    source.on('liquidation', (l) => this.onLiquidation(l));

    await source.start();
    this.ready = true;
  }

  // -- Handlers que actualizan estado y reemiten ServerMessage ---------------

  private send(msg: ServerMessage): void {
    this.emit('message', msg);
  }

  private onTrade(trade: Trade): void {
    this.price = trade.p;
    this.recentTrades.push(trade);
    if (this.recentTrades.length > config.recentTradesBuffer) this.recentTrades.shift();
    this.send({ type: 'trade', symbol: this.symbol, trade });
  }

  private onBook(book: OrderBook): void {
    this.book = book;
    this.send({ type: 'book', symbol: this.symbol, book });
  }

  private onFunding(funding: FundingInfo): void {
    this.funding = funding;
    if (this.price === 0) this.price = funding.markPrice;
    this.send({ type: 'funding', symbol: this.symbol, funding });
  }

  private onOi(oi: OpenInterest): void {
    this.oi = oi;
    this.send({ type: 'oi', symbol: this.symbol, openInterest: oi });
  }

  private onStats(stats: Stats24h, price: number): void {
    this.stats = stats;
    if (price > 0) this.price = price;
    this.send({ type: 'stats', symbol: this.symbol, stats, price: this.price });
  }

  private onLiquidation(liq: Liquidation): void {
    this.recentLiquidations.unshift(liq);
    if (this.recentLiquidations.length > config.recentLiquidationsBuffer) {
      this.recentLiquidations.pop();
    }
    this.send({ type: 'liquidation', symbol: this.symbol, liquidation: liq });
  }

  /** Estado completo para un cliente que acaba de suscribirse. */
  buildSnapshot(): ServerMessage {
    return {
      type: 'snapshot',
      symbol: this.symbol,
      price: this.price,
      funding: this.funding,
      openInterest: this.oi,
      stats: this.stats,
      book: this.book,
      recentTrades: this.recentTrades.slice(-config.recentTradesBuffer),
      recentLiquidations: this.recentLiquidations.slice(0, config.recentLiquidationsBuffer),
      live: this.live,
      serverTime: Date.now(),
    };
  }
}
