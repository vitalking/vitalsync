'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BookLevel, OrderBook as Book } from '@vitalsync/shared';
import { useStore } from '@/lib/MarketProvider';
import styles from './OrderBook.module.css';

const ROWS = 14;

function decimalsFor(price: number): number {
  if (price >= 10000) return 1;
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  return 4;
}

interface Row {
  price: number;
  qty: number;
  cum: number;
}

function buildRows(levels: BookLevel[]): { rows: Row[]; maxCum: number } {
  const rows: Row[] = [];
  let cum = 0;
  for (let i = 0; i < Math.min(levels.length, ROWS); i++) {
    cum += levels[i][1];
    rows.push({ price: levels[i][0], qty: levels[i][1], cum });
  }
  return { rows, maxCum: cum || 1 };
}

export function OrderBook() {
  const store = useStore();
  const [book, setBook] = useState<Book>({ bids: [], asks: [], lastUpdateId: 0 });
  const [price, setPrice] = useState(0);

  useEffect(() => {
    // Lectura throttled (~10 fps) del libro vivo del store.
    const id = setInterval(() => {
      setBook(store.book);
      setPrice(store.price);
    }, 100);
    return () => clearInterval(id);
  }, [store]);

  const dec = decimalsFor(price);

  const asks = useMemo(() => buildRows(book.asks), [book]);
  const bids = useMemo(() => buildRows(book.bids), [book]);
  const maxCum = Math.max(asks.maxCum, bids.maxCum);

  const bestAsk = book.asks[0]?.[0] ?? 0;
  const bestBid = book.bids[0]?.[0] ?? 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const spreadPct = bestBid ? (spread / bestBid) * 100 : 0;

  return (
    <div className={styles.book}>
      <div className="vs-panel-title">
        Libro de órdenes
        <span className={styles.depthTag}>{ROWS}×2</span>
      </div>

      <div className={styles.colHead}>
        <span>Precio</span>
        <span className={styles.right}>Tamaño</span>
        <span className={styles.right}>Total</span>
      </div>

      <div className={styles.side}>
        {[...asks.rows].reverse().map((r) => (
          <Level key={`a${r.price}`} row={r} maxCum={maxCum} dec={dec} side="ask" />
        ))}
      </div>

      <div className={styles.spread}>
        <span className={`${styles.spreadPrice} vs-mono`} style={{ color: store.priceDirection === -1 ? 'var(--vs-down)' : 'var(--vs-up)' }}>
          {price ? price.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'}
        </span>
        <span className={styles.spreadInfo}>
          Spread {spread ? spread.toFixed(dec) : '—'} ({spreadPct.toFixed(3)}%)
        </span>
      </div>

      <div className={styles.side}>
        {bids.rows.map((r) => (
          <Level key={`b${r.price}`} row={r} maxCum={maxCum} dec={dec} side="bid" />
        ))}
      </div>
    </div>
  );
}

function Level({
  row,
  maxCum,
  dec,
  side,
}: {
  row: Row;
  maxCum: number;
  dec: number;
  side: 'bid' | 'ask';
}) {
  const pct = (row.cum / maxCum) * 100;
  return (
    <div className={styles.level}>
      <div
        className={`${styles.depthBar} ${side === 'bid' ? styles.bidBar : styles.askBar}`}
        style={{ width: `${pct}%` }}
      />
      <span className={`${styles.price} vs-mono ${side === 'bid' ? styles.bidText : styles.askText}`}>
        {row.price.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec })}
      </span>
      <span className={`${styles.qty} vs-mono ${styles.right}`}>{row.qty.toFixed(3)}</span>
      <span className={`${styles.cum} vs-mono ${styles.right}`}>{row.cum.toFixed(2)}</span>
    </div>
  );
}
