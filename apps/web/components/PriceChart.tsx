'use client';

import { useEffect, useRef } from 'react';
import { clamp, lerp } from '@vitalsync/shared';
import { CHART_WINDOW_MS } from '@/lib/config';
import { useStore } from '@/lib/MarketProvider';
import styles from './PriceChart.module.css';

const ACCENT = '0,229,255';
const UP = '0,191,165';
const DOWN = '255,23,68';

function priceDecimals(price: number): number {
  if (price >= 10000) return 1;
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  return 4;
}

export function PriceChart() {
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      width = r.width;
      height = r.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Estado de render suavizado (desacoplado de los datos).
    let dispPrice = store.price || 0;
    let viewMin = 0;
    let viewMax = 0;
    let initialized = false;
    let raf = 0;
    let lastFrame = performance.now();

    const PAD_RIGHT = 64; // espacio para el eje de precios
    const PAD_V = 24;

    // Buffers reutilizados para evitar GC en cada frame.
    const xs: number[] = [];
    const ys: number[] = [];

    const render = (tNow: number) => {
      raf = requestAnimationFrame(render);
      const dt = Math.min((tNow - lastFrame) / 1000, 0.1);
      lastFrame = tNow;

      const now = Date.now();
      const fromT = now - CHART_WINDOW_MS;
      const plotW = width - PAD_RIGHT;
      const plotH = height - PAD_V * 2;
      if (plotW <= 0 || plotH <= 0) return;

      // 1) Recolectar puntos visibles + min/max objetivo.
      xs.length = 0;
      ys.length = 0;
      let tMin = Infinity;
      let tMax = -Infinity;
      store.priceRing.forEachSince(fromT, (t, p) => {
        xs.push(t);
        ys.push(p);
        if (p < tMin) tMin = p;
        if (p > tMax) tMax = p;
      });

      // Suavizado del precio actual hacia el último valor real.
      const target = store.price || dispPrice;
      // factor dependiente del tiempo => fluido e independiente de los fps
      const k = 1 - Math.pow(0.0001, dt);
      dispPrice = dispPrice === 0 ? target : lerp(dispPrice, target, clamp(k * 1.8, 0, 1));

      if (target > 0) {
        tMin = Math.min(tMin, dispPrice);
        tMax = Math.max(tMax, dispPrice);
      }
      if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) {
        ctx.clearRect(0, 0, width, height);
        drawEmpty(ctx, width, height);
        return;
      }
      if (tMin === tMax) {
        tMin -= tMin * 0.0005 || 1;
        tMax += tMax * 0.0005 || 1;
      }
      const padPrice = (tMax - tMin) * 0.12;
      const targetMin = tMin - padPrice;
      const targetMax = tMax + padPrice;

      if (!initialized) {
        viewMin = targetMin;
        viewMax = targetMax;
        initialized = true;
      } else {
        const ky = 1 - Math.pow(0.001, dt);
        viewMin = lerp(viewMin, targetMin, clamp(ky, 0, 1));
        viewMax = lerp(viewMax, targetMax, clamp(ky, 0, 1));
      }
      const range = viewMax - viewMin || 1;
      const yOf = (p: number) => PAD_V + (1 - (p - viewMin) / range) * plotH;
      const xOf = (t: number) => ((t - fromT) / CHART_WINDOW_MS) * plotW;

      // 2) Pintar.
      ctx.clearRect(0, 0, width, height);
      drawGrid(ctx, width, height, plotW, PAD_V, plotH, viewMin, viewMax, priceDecimals(target));

      const dir = store.priceDirection;
      const lineColor = dir === -1 ? DOWN : UP;

      if (xs.length >= 2) {
        const xRight = plotW;
        const yNow = yOf(dispPrice);

        // Área bajo la curva.
        ctx.beginPath();
        ctx.moveTo(xOf(xs[0]), yOf(ys[0]));
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xOf(xs[i]), yOf(ys[i]));
        ctx.lineTo(xRight, yNow);
        ctx.lineTo(xRight, height - PAD_V);
        ctx.lineTo(xOf(xs[0]), height - PAD_V);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, PAD_V, 0, height - PAD_V);
        grad.addColorStop(0, `rgba(${lineColor},0.18)`);
        grad.addColorStop(1, `rgba(${lineColor},0)`);
        ctx.fillStyle = grad;
        ctx.fill();

        // Línea principal.
        ctx.beginPath();
        ctx.moveTo(xOf(xs[0]), yOf(ys[0]));
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xOf(xs[i]), yOf(ys[i]));
        ctx.lineTo(xRight, yNow);
        ctx.strokeStyle = `rgba(${lineColor},0.9)`;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.shadowColor = `rgba(${lineColor},0.5)`;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Línea de precio actual + etiqueta.
        drawCurrentPrice(ctx, plotW, PAD_RIGHT, yNow, dispPrice, lineColor, priceDecimals(target), tNow);

        // Marcadores de liquidaciones recientes dentro de la ventana.
        drawLiquidations(ctx, store.liquidations, fromT, xOf, yOf, now);
      } else {
        drawEmpty(ctx, width, height);
      }
    };

    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [store]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.label}>PRECIO · TIEMPO REAL</div>
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  plotW: number,
  padV: number,
  plotH: number,
  vMin: number,
  vMax: number,
  dec: number,
) {
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.fillStyle = 'rgba(154,160,166,0.55)';
  ctx.lineWidth = 1;
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const rows = 5;
  for (let i = 0; i <= rows; i++) {
    const y = padV + (plotH * i) / rows;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
    const price = vMax - ((vMax - vMin) * i) / rows;
    ctx.fillText(
      price.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec }),
      plotW + 6,
      y,
    );
  }
  // Líneas verticales (tiempo).
  const cols = 6;
  for (let i = 0; i <= cols; i++) {
    const x = (plotW * i) / cols;
    ctx.beginPath();
    ctx.moveTo(x, padV);
    ctx.lineTo(x, height - padV);
    ctx.stroke();
  }
}

function drawCurrentPrice(
  ctx: CanvasRenderingContext2D,
  plotW: number,
  padRight: number,
  y: number,
  price: number,
  color: string,
  dec: number,
  tNow: number,
) {
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = `rgba(${color},0.5)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(plotW, y);
  ctx.stroke();
  ctx.setLineDash([]);

  // Etiqueta de precio.
  const label = price.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  ctx.font = '600 11px "JetBrains Mono", monospace';
  const tagW = padRight - 2;
  const tagH = 18;
  ctx.fillStyle = `rgba(${color},0.95)`;
  ctx.beginPath();
  ctx.roundRect(plotW + 2, y - tagH / 2, tagW, tagH, 3);
  ctx.fill();
  ctx.fillStyle = '#08090c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, plotW + 2 + tagW / 2, y);

  // Punto pulsante en el borde derecho.
  const pulse = (Math.sin(tNow * 0.005) * 0.5 + 0.5) * 0.6 + 0.4;
  ctx.beginPath();
  ctx.arc(plotW, y, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${color},${pulse})`;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(plotW, y, 6 + (1 - pulse) * 5, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${color},${pulse * 0.4})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLiquidations(
  ctx: CanvasRenderingContext2D,
  liqs: { side: 'BUY' | 'SELL'; price: number; value: number; t: number }[],
  fromT: number,
  xOf: (t: number) => number,
  yOf: (p: number) => number,
  now: number,
) {
  for (const l of liqs) {
    if (l.t < fromT) continue;
    const x = xOf(l.t);
    const y = yOf(l.price);
    const age = (now - l.t) / 8000;
    const alpha = clamp(1 - age, 0, 1);
    if (alpha <= 0) continue;
    const size = clamp(2 + Math.log10(Math.max(l.value, 1)) * 0.8, 2.5, 9);
    const c = l.side === 'BUY' ? UP : DOWN;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${c},${alpha * 0.5})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${c},${alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawEmpty(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.fillStyle = 'rgba(154,160,166,0.5)';
  ctx.font = '12px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Esperando datos del mercado…', width / 2, height / 2);
}
