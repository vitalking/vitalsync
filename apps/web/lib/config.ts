import { DEFAULT_SYMBOL, type Symbol } from '@vitalsync/shared';

/**
 * URL del servidor WebSocket agregador.
 * En producción se define con NEXT_PUBLIC_WS_URL (apuntando a Railway/Render/Fly).
 * En desarrollo cae al servidor local.
 */
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080/ws';

export const INITIAL_SYMBOL: Symbol = DEFAULT_SYMBOL;

/** Ventana temporal visible del gráfico (ms). */
export const CHART_WINDOW_MS = 90_000;

/** Capacidad del buffer de puntos de precio. */
export const PRICE_BUFFER_SIZE = 6000;
