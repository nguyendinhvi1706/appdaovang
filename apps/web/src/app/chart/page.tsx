'use client';
import { useState } from 'react';
import AppShell from '@/components/AppShell';
import TradingViewChart from '@/components/TradingViewChart';

const symbols = ['OANDA:XAUUSD', 'OANDA:EURUSD', 'OANDA:GBPUSD', 'OANDA:USDJPY', 'BINANCE:BTCUSDT'];

export default function ChartPage() {
  const [symbol, setSymbol] = useState(symbols[0]);
  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Biểu đồ</h1>
        <select className="input w-auto" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {symbols.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div className="card p-0"
        style={{ resize: 'both', overflow: 'hidden', height: 640, minHeight: 300, minWidth: 320, maxWidth: '100%' }}>
        <TradingViewChart symbol={symbol} />
      </div>
      <p className="text-xs text-gray-500 mt-1">↘ Kéo góc dưới-phải của khung để phóng to/thu nhỏ chart.</p>
    </AppShell>
  );
}
