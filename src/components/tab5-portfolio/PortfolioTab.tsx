import { useState } from 'react';
import { Segmented } from '../ui/Segmented';
import AssetDownloader from './AssetDownloader';
import EarningsAudit from './EarningsAudit';

export default function PortfolioTab() {
  const [view, setView] = useState<'audit' | 'assets'>('audit');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Portfolio Audit &amp; Asset Hub</h1>
        <p className="text-sm text-muted">Daily earnings split by live games vs OTD claims, and original CDN graphic extraction. Inspired by realapp.tools.</p>
      </div>
      <Segmented value={view} onChange={setView} label="View" options={[{ value: 'audit', label: 'Earnings audit' }, { value: 'assets', label: 'CDN assets' }]} />
      {view === 'audit' ? <EarningsAudit /> : <AssetDownloader />}
    </div>
  );
}
