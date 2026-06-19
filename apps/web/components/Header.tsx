'use client';

import { useEffect, useState } from 'react';
import {
  SUPPORTED_SYMBOLS,
  formatCompact,
  formatUsd,
  type Symbol,
} from '@vitalsync/shared';
import { useDisplay, useMarket } from '@/lib/MarketProvider';
import styles from './Header.module.css';

function priceDecimals(price: number): number {
  if (price >= 10000) return 1;
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  return 4;
}

function useCountdown(target: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!target || target <= now) return '--:--:--';
  const diff = Math.floor((target - now) / 1000);
  const h = String(Math.floor(diff / 3600)).padStart(2, '0');
  const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
  const s = String(diff % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function Header() {
  const { symbol, setSymbol } = useMarket();
  const d = useDisplay();
  const dec = priceDecimals(d.price);
  const up = d.stats.changePercent >= 0;
  const fundingPct = (d.funding.fundingRate * 100).toFixed(4);
  const countdown = useCountdown(d.funding.nextFundingTime);

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.logoMark} />
        <span className={styles.logoText}>VITALSYNC</span>
        <span className={styles.version}>v2</span>
      </div>

      <select
        className={styles.symbolSelect}
        value={symbol}
        onChange={(e) => setSymbol(e.target.value as Symbol)}
        aria-label="Seleccionar símbolo"
      >
        {SUPPORTED_SYMBOLS.map((s) => (
          <option key={s} value={s}>
            {s.replace('USDT', '')} / USDT
          </option>
        ))}
      </select>

      <div className={styles.priceBlock}>
        <span
          className={`${styles.price} vs-mono`}
          style={{ color: d.priceDirection === -1 ? 'var(--vs-down)' : 'var(--vs-up)' }}
        >
          {d.price ? formatUsd(d.price, dec) : '—'}
        </span>
        <span
          className={`${styles.change} vs-mono`}
          style={{ color: up ? 'var(--vs-up)' : 'var(--vs-down)' }}
        >
          {up ? '+' : ''}
          {d.stats.changePercent.toFixed(2)}%
        </span>
      </div>

      <div className={styles.metrics}>
        <Metric label="Máx 24h" value={d.stats.high ? formatUsd(d.stats.high, dec) : '—'} />
        <Metric label="Mín 24h" value={d.stats.low ? formatUsd(d.stats.low, dec) : '—'} />
        <Metric
          label="Volumen 24h"
          value={d.stats.quoteVolume ? `$${formatCompact(d.stats.quoteVolume)}` : '—'}
        />
        <Metric
          label="Open Interest"
          value={
            d.openInterest.openInterestValue
              ? `$${formatCompact(d.openInterest.openInterestValue)}`
              : '—'
          }
        />
        <Metric
          label="Funding"
          value={`${fundingPct}%`}
          color={d.funding.fundingRate >= 0 ? 'var(--vs-up)' : 'var(--vs-down)'}
        />
        <Metric label="Próx. funding" value={countdown} />
      </div>

      <div className={styles.status}>
        <span
          className={`${styles.dataBadge} ${d.live ? styles.badgeLive : styles.badgeSim}`}
          title={d.live ? 'Datos reales de Binance' : 'Datos simulados (demo)'}
        >
          {d.live ? 'BINANCE' : 'SIMULADO'}
        </span>
        <span className={`${styles.conn} ${d.connected ? styles.connOn : styles.connOff}`}>
          <span className={styles.connDot} />
          {d.connected ? 'En vivo' : 'Reconectando'}
        </span>
      </div>
    </header>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={`${styles.metricValue} vs-mono`} style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}
