import 'dotenv/config';
import { SUPPORTED_SYMBOLS, type Symbol } from '@vitalsync/shared';

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Modo de la fuente de datos:
 *  - 'binance'   : conexión real a Binance Futures.
 *  - 'simulated' : datos sintéticos (para entornos con Binance bloqueado o demos).
 *  - 'auto'      : intenta Binance y cae a simulado si falla la conexión inicial.
 */
export type SourceMode = 'binance' | 'simulated' | 'auto';

export const config = {
  port: envInt('PORT', 8080),
  host: process.env.HOST ?? '0.0.0.0',
  sourceMode: (process.env.SOURCE_MODE as SourceMode) ?? 'auto',

  // Símbolos que el servidor pre-arranca al iniciar (el resto se crean on-demand).
  preloadSymbols: (process.env.PRELOAD_SYMBOLS
    ? (process.env.PRELOAD_SYMBOLS.split(',') as Symbol[])
    : (['BTCUSDT'] as Symbol[])
  ).filter((s) => (SUPPORTED_SYMBOLS as readonly string[]).includes(s)),

  // Frecuencia de difusión del libro de órdenes a los clientes (ms).
  bookBroadcastIntervalMs: envInt('BOOK_BROADCAST_MS', 100),
  // Profundidad del libro que se envía a la UI (niveles por lado).
  bookDepth: envInt('BOOK_DEPTH', 25),
  // Intervalo de polling de Open Interest (ms).
  oiPollIntervalMs: envInt('OI_POLL_MS', 15000),

  // Endpoints de Binance USD-M Futures.
  binanceRestBase: process.env.BINANCE_REST_BASE ?? 'https://fapi.binance.com',
  binanceWsBase: process.env.BINANCE_WS_BASE ?? 'wss://fstream.binance.com',

  // Si el handshake inicial con Binance falla, cuántos ms esperar antes de
  // declarar fallo y (en modo 'auto') caer a simulado.
  binanceConnectTimeoutMs: envInt('BINANCE_CONNECT_TIMEOUT_MS', 8000),

  // Tamaño de los buffers de histórico que se envían en el snapshot.
  recentTradesBuffer: envInt('RECENT_TRADES', 60),
  recentLiquidationsBuffer: envInt('RECENT_LIQUIDATIONS', 30),

  verbose: envBool('VERBOSE', true),
};

export type Config = typeof config;
