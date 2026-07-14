'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Quote = { price: number | null; change: number | null; previousClose: number | null };

export default function GoldPrice() {
  const [quote, setQuote] = useState<Quote | null>(null);

  useEffect(() => {
    const load = () => api<Quote>('/market/gold').then(setQuote).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const up = (quote?.change ?? 0) >= 0;

  return (
    <div className="card">
      <div className="text-sm text-gray-400">XAUUSD — Vàng</div>
      <div className="text-3xl font-bold mt-1">
        {quote?.price != null ? quote.price.toFixed(2) : '...'}
      </div>
      {quote?.change != null && (
        <div className={`text-sm mt-1 ${up ? 'text-green-400' : 'text-red-400'}`}>
          {up ? '▲' : '▼'} {quote.change.toFixed(2)} so với đóng cửa
        </div>
      )}
    </div>
  );
}
