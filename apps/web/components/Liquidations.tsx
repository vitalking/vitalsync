'use client';

import { useEffect, useState } from 'react';
import { formatCompact, type Liquidation } from '@vitalsync/shared';
import { useStore } from '@/lib/MarketProvider';
import styles from './Liquidations.module.css';

function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function decimalsFor(price: number): number {
  if (price >= 10000) return 1;
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  return 4;
}

export function Liquidations() {
  const store = useStore();
  const [liqs, setLiqs] = useState<Liquidation[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setLiqs(store.liquidations.slice(0, 30));
      setTick((t) => t + 1);
    }, 400);
    return () => clearInterval(id);
  }, [store]);

  // Totales (largos vs cortos liquidados) de la ventana visible.
  const longLiq = liqs.filter((l) => l.side === 'SELL').reduce((a, l) => a + l.value, 0);
  const shortLiq = liqs.filter((l) => l.side === 'BUY').reduce((a, l) => a + l.value, 0);

  return (
    <div className={styles.panel} data-tick={tick}>
      <div className="vs-panel-title">
        Liquidaciones
        <span className={styles.totals}>
          <span className={styles.longTotal}>Largos ${formatCompact(longLiq)}</span>
          <span className={styles.shortTotal}>Cortos ${formatCompact(shortLiq)}</span>
        </span>
      </div>

      <div className={styles.colHead}>
        <span>Lado</span>
        <span>Precio</span>
        <span className={styles.right}>Valor</span>
        <span className={styles.right}>Hace</span>
      </div>

      <div className={styles.feed}>
        {liqs.length === 0 && <div className={styles.empty}>Sin liquidaciones recientes…</div>}
        {liqs.map((l, i) => {
          const isLong = l.side === 'SELL'; // venta forzada = liquidación de largos
          const dec = decimalsFor(l.price);
          return (
            <div key={`${l.t}-${i}`} className={styles.row}>
              <span className={`${styles.tag} ${isLong ? styles.long : styles.short}`}>
                {isLong ? 'LARGO' : 'CORTO'}
              </span>
              <span className="vs-mono">
                {l.price.toLocaleString('es-ES', {
                  minimumFractionDigits: dec,
                  maximumFractionDigits: dec,
                })}
              </span>
              <span className={`${styles.right} vs-mono ${isLong ? styles.longText : styles.shortText}`}>
                ${formatCompact(l.value)}
              </span>
              <span className={`${styles.right} vs-mono ${styles.age}`}>{timeAgo(l.t)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
