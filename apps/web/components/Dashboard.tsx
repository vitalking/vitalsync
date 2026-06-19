'use client';

import { Header } from './Header';
import { PriceChart } from './PriceChart';
import { OrderBook } from './OrderBook';
import { Liquidations } from './Liquidations';

export function Dashboard() {
  return (
    <div className="vs-app">
      <Header />
      <div className="vs-body">
        <section className="vs-cell vs-chart-cell">
          <PriceChart />
        </section>
        <section className="vs-cell vs-book-cell">
          <OrderBook />
        </section>
        <section className="vs-cell vs-liq-cell">
          <Liquidations />
        </section>
      </div>
    </div>
  );
}
