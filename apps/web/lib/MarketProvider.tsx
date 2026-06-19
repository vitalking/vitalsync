'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ClientMessage, ServerMessage, Symbol } from '@vitalsync/shared';
import { INITIAL_SYMBOL, WS_URL } from './config';
import { MarketStore, type DisplaySnapshot } from './marketStore';
import { BinanceDirectSource } from './binanceDirect';

/** Origen de datos activo. */
export type DataMode = 'connecting' | 'server' | 'direct';

interface MarketContextValue {
  store: MarketStore;
  symbol: Symbol;
  setSymbol: (s: Symbol) => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

/** Tiempo que esperamos al servidor antes de caer a Binance directo (ms). */
const SERVER_WAIT_MS = 5000;

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<MarketStore | null>(null);
  if (!storeRef.current) storeRef.current = new MarketStore(INITIAL_SYMBOL);
  const store = storeRef.current;

  const [symbol, setSymbolState] = useState<Symbol>(INITIAL_SYMBOL);
  const wsRef = useRef<WebSocket | null>(null);
  const directRef = useRef<BinanceDirectSource | null>(null);
  const symbolRef = useRef<Symbol>(symbol);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<DataMode>('connecting');
  const closedRef = useRef(false);

  const clearWatchdog = () => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  };

  const stopServer = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    }
  }, []);

  const stopDirect = useCallback(() => {
    directRef.current?.stop();
    directRef.current = null;
  }, []);

  // Conexión directa a Binance (fallback).
  const startDirect = useCallback(() => {
    if (closedRef.current || modeRef.current === 'direct') return;
    modeRef.current = 'direct';
    clearWatchdog();
    stopServer();
    const src = new BinanceDirectSource(store, symbolRef.current);
    directRef.current = src;
    src.start();
  }, [store, stopServer]);

  // Conexión al servidor agregador.
  const connectServer = useCallback(() => {
    if (closedRef.current) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      startDirect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      const msg: ClientMessage = { type: 'subscribe', symbol: symbolRef.current };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      // Primer dato real del servidor: lo adoptamos como fuente.
      if (modeRef.current !== 'server') {
        modeRef.current = 'server';
        clearWatchdog();
        stopDirect();
        store.setConnected(true);
      }
      store.apply(msg);
    };

    ws.onclose = () => {
      if (closedRef.current) return;
      // Si nunca llegamos a recibir datos del servidor, vamos a Binance directo.
      if (modeRef.current !== 'server') startDirect();
      else store.setConnected(false);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };

    // Vigilante: si el servidor no responde a tiempo, usamos Binance directo.
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (modeRef.current !== 'server') startDirect();
    }, SERVER_WAIT_MS);
  }, [startDirect, stopDirect, store]);

  // Arranque (una sola vez).
  useEffect(() => {
    closedRef.current = false;
    store.startNotifyLoop();
    connectServer();
    return () => {
      closedRef.current = true;
      store.stopNotifyLoop();
      clearWatchdog();
      stopServer();
      stopDirect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSymbol = useCallback(
    (next: Symbol) => {
      if (next === symbolRef.current) return;
      symbolRef.current = next;
      store.reset(next);
      // Reiniciamos las fuentes para el nuevo símbolo.
      stopDirect();
      stopServer();
      modeRef.current = 'connecting';
      setSymbolState(next);
      connectServer();
    },
    [connectServer, stopDirect, stopServer, store],
  );

  const value = useMemo<MarketContextValue>(
    () => ({ store, symbol, setSymbol }),
    [store, symbol, setSymbol],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket debe usarse dentro de <MarketProvider>');
  return ctx;
}

/** Hook de baja frecuencia para paneles numéricos (re-render throttled). */
export function useDisplay(): DisplaySnapshot {
  const { store } = useMarket();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Acceso directo al store para componentes canvas (sin re-render). */
export function useStore(): MarketStore {
  return useMarket().store;
}
