import type { ServerMessage, Symbol } from '@vitalsync/shared';
import { log } from './logger.js';
import { SymbolAggregator } from './symbolAggregator.js';

/** Conexión de cliente: cualquier cosa capaz de recibir un ServerMessage. */
export interface ClientConn {
  id: string;
  send(msg: ServerMessage): void;
  readonly subscriptions: Set<Symbol>;
}

/**
 * Coordina los agregadores por símbolo y el reparto (fan-out) a los clientes.
 * Crea agregadores bajo demanda y reutiliza uno solo por símbolo para todos
 * los clientes — una única conexión a Binance por símbolo, como CoinGlass.
 */
export class Hub {
  private aggregators = new Map<Symbol, SymbolAggregator>();
  private subscribers = new Map<Symbol, Set<ClientConn>>();
  private starting = new Map<Symbol, Promise<void>>();

  async preload(symbols: Symbol[]): Promise<void> {
    await Promise.all(symbols.map((s) => this.ensureAggregator(s)));
  }

  private async ensureAggregator(symbol: Symbol): Promise<SymbolAggregator> {
    const existing = this.aggregators.get(symbol);
    if (existing) return existing;

    const pending = this.starting.get(symbol);
    if (pending) {
      await pending;
      return this.aggregators.get(symbol)!;
    }

    const agg = new SymbolAggregator(symbol);
    this.subscribers.set(symbol, this.subscribers.get(symbol) ?? new Set());
    agg.on('message', (msg: ServerMessage) => this.broadcast(symbol, msg));

    const startPromise = agg
      .start()
      .then(() => {
        this.aggregators.set(symbol, agg);
        log.info(`[hub] agregador listo para ${symbol} (live=${agg.isLive()})`);
      })
      .finally(() => this.starting.delete(symbol));

    this.starting.set(symbol, startPromise);
    await startPromise;
    return agg;
  }

  async subscribe(client: ClientConn, symbol: Symbol): Promise<void> {
    const agg = await this.ensureAggregator(symbol);
    let set = this.subscribers.get(symbol);
    if (!set) {
      set = new Set();
      this.subscribers.set(symbol, set);
    }
    set.add(client);
    client.subscriptions.add(symbol);
    // Snapshot inmediato del estado actual.
    client.send(agg.buildSnapshot());
    log.debug(`[hub] ${client.id} suscrito a ${symbol} (${set.size} clientes)`);
  }

  unsubscribe(client: ClientConn, symbol: Symbol): void {
    this.subscribers.get(symbol)?.delete(client);
    client.subscriptions.delete(symbol);
  }

  removeClient(client: ClientConn): void {
    for (const symbol of client.subscriptions) {
      this.subscribers.get(symbol)?.delete(client);
    }
    client.subscriptions.clear();
  }

  private broadcast(symbol: Symbol, msg: ServerMessage): void {
    const set = this.subscribers.get(symbol);
    if (!set || set.size === 0) return;
    for (const client of set) {
      client.send(msg);
    }
  }

  stats() {
    const result: Record<string, { clients: number; live: boolean }> = {};
    for (const [symbol, agg] of this.aggregators) {
      result[symbol] = {
        clients: this.subscribers.get(symbol)?.size ?? 0,
        live: agg.isLive(),
      };
    }
    return result;
  }
}
