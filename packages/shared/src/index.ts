/**
 * @vitalsync/shared
 * Protocolo de mensajes y tipos compartidos entre el servidor agregador y el frontend.
 *
 * Todos los precios y cantidades viajan como `number` (ya parseados) para evitar
 * parseFloat repetido en el cliente y mantener el render fluido.
 */

/** Símbolos soportados (Binance USD-M Futures). */
export const SUPPORTED_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
] as const;

export type Symbol = (typeof SUPPORTED_SYMBOLS)[number];

export const DEFAULT_SYMBOL: Symbol = 'BTCUSDT';

export function isSupportedSymbol(value: string): value is Symbol {
  return (SUPPORTED_SYMBOLS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Estructuras de datos de mercado
// ---------------------------------------------------------------------------

/** Un nivel del libro de órdenes: [precio, cantidad]. */
export type BookLevel = [price: number, qty: number];

/** Foto del libro de órdenes (top N agregado para la UI). */
export interface OrderBook {
  bids: BookLevel[]; // ordenado de mayor a menor precio
  asks: BookLevel[]; // ordenado de menor a mayor precio
  lastUpdateId: number;
}

/** Operación individual (tick a tick). */
export interface Trade {
  /** Precio de la operación. */
  p: number;
  /** Cantidad (en el activo base). */
  q: number;
  /** true si el comprador es el maker (presión vendedora agresiva). */
  m: boolean;
  /** Timestamp en ms. */
  t: number;
}

/** Liquidación forzada (forceOrder). */
export interface Liquidation {
  /** 'BUY' = liquidación de cortos, 'SELL' = liquidación de largos. */
  side: 'BUY' | 'SELL';
  price: number;
  /** Cantidad en el activo base. */
  qty: number;
  /** Valor nominal en USD (price * qty). */
  value: number;
  t: number;
}

/** Estadísticas de 24h. */
export interface Stats24h {
  high: number;
  low: number;
  /** Cambio porcentual de precio en 24h. */
  changePercent: number;
  /** Volumen en quote (USDT) de 24h. */
  quoteVolume: number;
  /** Volumen en base de 24h. */
  volume: number;
}

/** Estado de funding / mark price. */
export interface FundingInfo {
  markPrice: number;
  /** Tasa de funding actual (ej. 0.0001 = 0.01%). */
  fundingRate: number;
  /** Próximo funding en ms epoch. */
  nextFundingTime: number;
}

/** Open Interest. */
export interface OpenInterest {
  /** OI en contratos / base asset. */
  openInterest: number;
  /** OI nominal en USD. */
  openInterestValue: number;
  t: number;
}

// ---------------------------------------------------------------------------
// Mensajes Cliente -> Servidor
// ---------------------------------------------------------------------------

export interface SubscribeMessage {
  type: 'subscribe';
  symbol: string;
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  symbol: string;
}

export interface PingMessage {
  type: 'ping';
  t: number;
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | PingMessage;

// ---------------------------------------------------------------------------
// Mensajes Servidor -> Cliente
// ---------------------------------------------------------------------------

/** Estado completo enviado al suscribirse a un símbolo. */
export interface SnapshotMessage {
  type: 'snapshot';
  symbol: Symbol;
  price: number;
  funding: FundingInfo;
  openInterest: OpenInterest;
  stats: Stats24h;
  book: OrderBook;
  recentTrades: Trade[];
  recentLiquidations: Liquidation[];
  /** true si los datos provienen de Binance real; false si son simulados. */
  live: boolean;
  serverTime: number;
}

export interface TradeMessage {
  type: 'trade';
  symbol: Symbol;
  trade: Trade;
}

/** Actualización del libro (top N agregado, throttled). */
export interface BookMessage {
  type: 'book';
  symbol: Symbol;
  book: OrderBook;
}

export interface FundingMessage {
  type: 'funding';
  symbol: Symbol;
  funding: FundingInfo;
}

export interface OpenInterestMessage {
  type: 'oi';
  symbol: Symbol;
  openInterest: OpenInterest;
}

export interface LiquidationMessage {
  type: 'liquidation';
  symbol: Symbol;
  liquidation: Liquidation;
}

export interface StatsMessage {
  type: 'stats';
  symbol: Symbol;
  stats: Stats24h;
  price: number;
}

export interface PongMessage {
  type: 'pong';
  t: number;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | SnapshotMessage
  | TradeMessage
  | BookMessage
  | FundingMessage
  | OpenInterestMessage
  | LiquidationMessage
  | StatsMessage
  | PongMessage
  | ErrorMessage;

// ---------------------------------------------------------------------------
// Helpers de formato (compartidos por servidor y cliente)
// ---------------------------------------------------------------------------

export function formatUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return (value / 1e9).toFixed(2) + ' B';
  if (abs >= 1e6) return (value / 1e6).toFixed(2) + ' M';
  if (abs >= 1e3) return (value / 1e3).toFixed(2) + ' K';
  return value.toFixed(2);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
