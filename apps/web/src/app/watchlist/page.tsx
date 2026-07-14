'use client';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type Item = { id: string; symbol: string; note?: string };
type Quote = { price: number | null; change: number | null };

export default function WatchlistPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [symbol, setSymbol] = useState('');

  const load = () => api<Item[]>('/watchlist').then(setItems);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    items.forEach((it) => {
      const ySymbol = it.symbol.length === 6 ? `${it.symbol}=X` : it.symbol;
      api<Quote>(`/market/quote/${encodeURIComponent(ySymbol)}`)
        .then((q) => setQuotes((prev) => ({ ...prev, [it.symbol]: q })))
        .catch(() => {});
    });
  }, [items]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol.trim()) return;
    await api('/watchlist', { method: 'POST', body: JSON.stringify({ symbol: symbol.trim() }) });
    setSymbol('');
    load();
  }

  async function remove(id: string) {
    await api(`/watchlist/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <AppShell>
      <h1 className="text-2xl font-bold mb-4">Watchlist</h1>
      <form onSubmit={add} className="flex gap-2 mb-4 max-w-md">
        <input className="input" placeholder="Symbol (VD: XAUUSD, EURUSD)" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <button className="btn">Thêm</button>
      </form>
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-gray-400 text-left">
              <th className="p-3">Symbol</th>
              <th className="p-3">Giá</th>
              <th className="p-3">Thay đổi</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const q = quotes[it.symbol];
              const up = (q?.change ?? 0) >= 0;
              return (
                <tr key={it.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-semibold">{it.symbol}</td>
                  <td className="p-3">{q?.price?.toFixed(4) ?? '...'}</td>
                  <td className={`p-3 ${up ? 'text-green-400' : 'text-red-400'}`}>
                    {q?.change != null ? `${up ? '+' : ''}${q.change.toFixed(4)}` : '...'}
                  </td>
                  <td className="p-3 text-right">
                    <button onClick={() => remove(it.id)} className="text-gray-500 hover:text-red-400">✕</button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center text-gray-500">Chưa có symbol nào. Thêm XAUUSD để bắt đầu!</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
