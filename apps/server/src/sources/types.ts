import { EventEmitter } from 'node:events';
import type {
  FundingInfo,
  Liquidation,
  OpenInterest,
  OrderBook,
  Stats24h,
  Symbol,
  Trade,
} from '@vitalsync/shared';

/**
 * Eventos que toda fuente de datos emite. El agregador (SymbolAggregator)
 * se suscribe a ellos sin saber si vienen de Binance o de la simulación.
 */
export interface DataSourceEvents {
  trade: (trade: Trade) => void;
  /** Libro completo (top-N agregado) ya actualizado y listo para difundir. */
  book: (book: OrderBook) => void;
  funding: (funding: FundingInfo) => void;
  oi: (oi: OpenInterest) => void;
  liquidation: (liq: Liquidation) => void;
  stats: (stats: Stats24h, price: number) => void;
  /** La fuente está lista (snapshot inicial disponible). */
  ready: () => void;
  /** Error no recuperable del handshake inicial. */
  fatal: (err: Error) => void;
}

export interface DataSource {
  readonly symbol: Symbol;
  /** true si emite datos reales de Binance. */
  readonly live: boolean;

  start(): Promise<void>;
  stop(): void;

  on<E extends keyof DataSourceEvents>(event: E, listener: DataSourceEvents[E]): this;
  off<E extends keyof DataSourceEvents>(event: E, listener: DataSourceEvents[E]): this;
}

/** Base con tipado fuerte de eventos sobre EventEmitter. */
export class TypedEmitter extends EventEmitter {
  emitTyped<E extends keyof DataSourceEvents>(
    event: E,
    ...args: Parameters<DataSourceEvents[E]>
  ): boolean {
    return this.emit(event, ...args);
  }
}
