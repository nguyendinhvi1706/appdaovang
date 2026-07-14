'use client';
import { useEffect, useRef } from 'react';

export default function TradingViewChart({ symbol = 'OANDA:XAUUSD' }: { symbol?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbol,
      interval: '15',
      theme: 'dark',
      style: '1',
      locale: 'vi_VN',
      autosize: true,
      allow_symbol_change: true,
      studies: [],
    });
    ref.current.appendChild(script);
  }, [symbol]);

  return <div ref={ref} className="tradingview-widget-container" style={{ width: '100%', height: '100%' }} />;
}
