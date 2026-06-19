import { MarketProvider } from '@/lib/MarketProvider';
import { Dashboard } from '@/components/Dashboard';

export default function Page() {
  return (
    <MarketProvider>
      <Dashboard />
    </MarketProvider>
  );
}
