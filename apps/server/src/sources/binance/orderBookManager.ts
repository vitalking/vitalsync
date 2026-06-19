import type { BookLevel, OrderBook } from '@vitalsync/shared';
import { log } from '../../logger.js';

interface DepthDiff {
  U: number; // primer updateId del evento
  u: number; // último updateId del evento
  pu: number; // último updateId del evento anterior (continuidad, futuros)
  b: [string, string][]; // bids
  a: [string, string][]; // asks
}

/**
 * Mantiene un libro de órdenes local sincronizado con Binance USD-M Futures
 * siguiendo el algoritmo oficial:
 *
 * 1. Almacenar en buffer los eventos del stream @depth mientras se pide el snapshot.
 * 2. GET /fapi/v1/depth?limit=1000 para obtener el snapshot.
 * 3. Descartar eventos con u < lastUpdateId del snapshot.
 * 4. El primer evento válido debe cumplir U <= lastUpdateId <= u.
 * 5. A partir de ahí, cada evento debe encadenar: pu == último u procesado;
 *    si se rompe la cadena, se re-sincroniza.
 *
 * Niveles con cantidad 0 se eliminan.
 */
export class OrderBookManager {
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private lastUpdateId = 0;
  private buffer: DepthDiff[] = [];
  private synced = false;
  private lastResyncAt = 0;
  private syncing = false;
  private fetchSnapshot: () => Promise<{
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
  }>;

  constructor(
    private readonly symbol: string,
    fetchSnapshot: () => Promise<{
      lastUpdateId: number;
      bids: [string, string][];
      asks: [string, string][];
    }>,
  ) {
    this.fetchSnapshot = fetchSnapshot;
  }

  reset(): void {
    this.bids.clear();
    this.asks.clear();
    this.buffer = [];
    this.synced = false;
    this.lastUpdateId = 0;
  }

  /** Inicia la sincronización: pide snapshot y procesa el buffer acumulado. */
  async sync(): Promise<void> {
    this.synced = false;
    this.syncing = true;
    try {
      const snap = await this.fetchSnapshot();
      this.bids.clear();
      this.asks.clear();
      for (const [p, q] of snap.bids) this.setLevel(this.bids, p, q);
      for (const [p, q] of snap.asks) this.setLevel(this.asks, p, q);
      this.lastUpdateId = snap.lastUpdateId;

      // Procesar eventos almacenados que sean posteriores al snapshot.
      const pending = this.buffer.filter((e) => e.u >= this.lastUpdateId);
      this.buffer = [];
      let first = true;
      for (const ev of pending) {
        if (first) {
          if (ev.U <= this.lastUpdateId && this.lastUpdateId <= ev.u) {
            this.apply(ev);
            first = false;
          }
          // si no encaja todavía, lo saltamos (es anterior)
          continue;
        }
        this.apply(ev);
      }
      this.synced = true;
      log.debug(`[book ${this.symbol}] sincronizado en updateId ${this.lastUpdateId}`);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Procesa un evento diff del stream.
   *
   * Usamos la ventana U/u (estándar y robusta) en lugar de exigir pu == lastUpdateId:
   *  - Evento totalmente antiguo (u <= lastUpdateId): ya aplicado, se ignora.
   *  - Hueco real (U > lastUpdateId + 1): faltan actualizaciones -> re-sincronizar.
   *  - En cualquier otro caso (contiguo o solapado): aplicar.
   *
   * Esto evita la "tormenta de re-sincronización" que saturaba el CPU pidiendo
   * el snapshot de 1000 niveles muchas veces por segundo.
   */
  onDiff(ev: DepthDiff): void {
    if (!this.synced) {
      this.buffer.push(ev);
      if (this.buffer.length > 2000) this.buffer.shift();
      return;
    }

    // Evento completamente antiguo: sus cambios ya están aplicados.
    if (ev.u <= this.lastUpdateId) return;

    // Hueco real en la secuencia: nos faltan eventos intermedios.
    if (ev.U > this.lastUpdateId + 1) {
      const now = Date.now();
      // Throttle: como máximo una re-sincronización por segundo. Mientras tanto
      // aplicamos el evento para no congelar el libro ni saturar el REST.
      if (now - this.lastResyncAt < 1000 || this.syncing) {
        this.apply(ev);
        return;
      }
      this.lastResyncAt = now;
      log.warn(
        `[book ${this.symbol}] hueco detectado (U=${ev.U} > esperado=${this.lastUpdateId + 1}); re-sincronizando`,
      );
      this.synced = false;
      this.buffer = [ev];
      void this.sync().catch((e) => log.error(`[book ${this.symbol}] resync falló`, e));
      return;
    }

    // Contiguo o solapado: aplicar normalmente.
    this.apply(ev);
  }

  private apply(ev: DepthDiff): void {
    for (const [p, q] of ev.b) this.setLevel(this.bids, p, q);
    for (const [p, q] of ev.a) this.setLevel(this.asks, p, q);
    this.lastUpdateId = ev.u;
  }

  private setLevel(side: Map<number, number>, priceStr: string, qtyStr: string): void {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (qty === 0) side.delete(price);
    else side.set(price, qty);
  }

  isSynced(): boolean {
    return this.synced;
  }

  /** Devuelve el top-N agregado, listo para enviar a la UI. */
  snapshot(depth: number): OrderBook {
    const bids: BookLevel[] = [...this.bids.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, depth);
    const asks: BookLevel[] = [...this.asks.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, depth);
    return { bids, asks, lastUpdateId: this.lastUpdateId };
  }
}
