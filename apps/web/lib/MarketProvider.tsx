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

interface MarketContextValue {
  store: MarketStore;
  symbol: Symbol;
  setSymbol: (s: Symbol) => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<MarketStore | null>(null);
  if (!storeRef.current) storeRef.current = new MarketStore(INITIAL_SYMBOL);
  const store = storeRef.current;

  const [symbol, setSymbolState] = useState<Symbol>(INITIAL_SYMBOL);
  const wsRef = useRef<WebSocket | null>(null);
  const symbolRef = useRef<Symbol>(symbol);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      store.setConnected(true);
      send({ type: 'subscribe', symbol: symbolRef.current });
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      store.apply(msg);
    };

    ws.onclose = () => {
      store.setConnected(false);
      if (!closedRef.current) scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    function scheduleReconnect() {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const delay = Math.min(1000 * 2 ** attemptRef.current, 15000);
      attemptRef.current++;
      reconnectRef.current = setTimeout(connect, delay);
    }
  }, [send, store]);

  // Conexión + bucle de notificación (una sola vez).
  useEffect(() => {
    closedRef.current = false;
    store.startNotifyLoop();
    connect();
    return () => {
      closedRef.current = true;
      store.stopNotifyLoop();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSymbol = useCallback(
    (next: Symbol) => {
      if (next === symbolRef.current) return;
      send({ type: 'unsubscribe', symbol: symbolRef.current });
      symbolRef.current = next;
      store.reset(next);
      setSymbolState(next);
      send({ type: 'subscribe', symbol: next });
    },
    [send, store],
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
