'use client';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api, uploadsUrl } from '@/lib/api';

type Entry = {
  id: string; symbol: string; direction: 'BUY' | 'SELL';
  entryPrice: number; exitPrice?: number; lotSize: number;
  stopLoss?: number; takeProfit?: number;
  result: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN'; pnl?: number;
  emotion?: string; mistakes?: string; notes?: string;
  imageBefore?: string; imageAfter?: string; openedAt: string;
};

const resultColor: Record<string, string> = {
  WIN: 'text-green-400', LOSS: 'text-red-400', BREAKEVEN: 'text-gray-400', OPEN: 'text-yellow-400',
};
const resultLabel: Record<string, string> = {
  WIN: 'Thắng', LOSS: 'Thua', BREAKEVEN: 'Hòa', OPEN: 'Đang mở',
};

type Insights = {
  enough: boolean;
  message: string | null;
  aiSummary: string | null;
  findings: string[];
  stats: {
    total: number;
    bySession: { key: string; trades: number; winRate: number; pnl: number }[];
    byDirection: { key: string; trades: number; winRate: number; pnl: number }[];
    byEmotion: { key: string; trades: number; winRate: number; pnl: number }[];
    byWeekday: { key: string; trades: number; winRate: number; pnl: number }[];
  } | null;
};

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);

  const [sharedOk, setSharedOk] = useState(false);

  async function shareInsights() {
    if (!insights?.enough || !insights.stats) return;
    await api('/shared', {
      method: 'POST',
      body: JSON.stringify({
        type: 'JOURNAL',
        title: `Thống kê ${insights.stats.total} lệnh của tôi`,
        description: insights.findings[0] ?? '',
        content: JSON.stringify({ stats: insights.stats, findings: insights.findings }, null, 2),
      }),
    });
    setSharedOk(true);
    setTimeout(() => setSharedOk(false), 3000);
  }

  async function analyze() {
    setLoadingInsights(true);
    try {
      setInsights(await api<Insights>('/ai/journal-insights'));
    } catch (err: any) {
      setInsights({ enough: false, message: err.message, aiSummary: null, findings: [], stats: null });
    } finally {
      setLoadingInsights(false);
    }
  }

  const load = () => api<Entry[]>('/journal').then(setEntries);
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData(e.currentTarget);
      // Bỏ các field rỗng để validation không lỗi
      Array.from(fd.entries()).forEach(([k, v]) => {
        if (v === '' || (v instanceof File && v.size === 0)) fd.delete(k);
      });
      await api('/journal', { method: 'POST', body: fd });
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Xóa lệnh này?')) return;
    await api(`/journal/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">Nhật ký giao dịch</h1>
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded-lg border border-border hover:border-accent transition"
            onClick={analyze} disabled={loadingInsights}>
            {loadingInsights ? 'Đang phân tích...' : '🧠 AI phân tích'}
          </button>
          <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? 'Đóng' : '+ Ghi lệnh mới'}</button>
        </div>
      </div>

      {insights && (
        <div className="card mb-4 border-accent/40">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-accent">🧠 AI phân tích nhật ký</span>
            {insights.enough && (
              <button className="text-sm text-gray-400 hover:text-accent" onClick={shareInsights}>
                {sharedOk ? '✅ Đã chia sẻ' : '📤 Chia sẻ thống kê'}
              </button>
            )}
          </div>
          {!insights.enough && <p className="text-gray-400 text-sm">{insights.message}</p>}
          {insights.enough && (
            <>
              {insights.aiSummary && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap mb-3">{insights.aiSummary}</p>
              )}
              <ul className="text-sm space-y-1 mb-3">
                {insights.findings.map((f, i) => (
                  <li key={i} className="flex gap-2"><span className="text-accent">▸</span>{f}</li>
                ))}
              </ul>
              {insights.stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {([['Theo phiên', insights.stats.bySession], ['Theo thứ', insights.stats.byWeekday]] as const).map(([title, rows]) => (
                    <div key={title}>
                      <div className="text-gray-400 mb-1">{title}</div>
                      {rows.map((r) => (
                        <div key={r.key} className="flex items-center gap-2 py-0.5">
                          <span className="w-28 shrink-0">{r.key}</span>
                          <div className="flex-1 bg-surface rounded h-2 overflow-hidden">
                            <div className={`h-2 ${r.winRate >= 50 ? 'bg-green-500' : 'bg-red-500'}`} style={{ width: `${r.winRate}%` }} />
                          </div>
                          <span className="w-24 text-right text-gray-400">{r.winRate}% · {r.trades} lệnh</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="card grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <input className="input" name="symbol" placeholder="Symbol (XAUUSD)" required />
          <select className="input" name="direction" required>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          <input className="input" name="entryPrice" type="number" step="any" placeholder="Giá vào" required />
          <input className="input" name="lotSize" type="number" step="any" placeholder="Lot" required />
          <input className="input" name="stopLoss" type="number" step="any" placeholder="SL" />
          <input className="input" name="takeProfit" type="number" step="any" placeholder="TP" />
          <input className="input" name="exitPrice" type="number" step="any" placeholder="Giá thoát" />
          <select className="input" name="result">
            <option value="OPEN">Đang mở</option>
            <option value="WIN">Thắng</option>
            <option value="LOSS">Thua</option>
            <option value="BREAKEVEN">Hòa</option>
          </select>
          <input className="input" name="pnl" type="number" step="any" placeholder="PnL ($)" />
          <input className="input" name="emotion" placeholder="Cảm xúc (FOMO, tự tin...)" />
          <input className="input md:col-span-2" name="mistakes" placeholder="Lỗi mắc phải" />
          <textarea className="input md:col-span-4" name="notes" placeholder="Ghi chú / setup / lý do vào lệnh" rows={2} />
          <label className="text-sm text-gray-400 md:col-span-2">
            Ảnh trước khi vào lệnh
            <input className="input mt-1" name="imageBefore" type="file" accept="image/*" />
          </label>
          <label className="text-sm text-gray-400 md:col-span-2">
            Ảnh sau khi đóng lệnh
            <input className="input mt-1" name="imageAfter" type="file" accept="image/*" />
          </label>
          <button className="btn md:col-span-4" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu lệnh'}</button>
        </form>
      )}

      <div className="space-y-3">
        {entries.map((en) => (
          <div key={en.id} className="card">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold">{en.symbol}</span>
              <span className={en.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}>{en.direction}</span>
              <span className="text-sm text-gray-400">{en.lotSize} lot @ {en.entryPrice}</span>
              {en.stopLoss && <span className="text-sm text-gray-500">SL {en.stopLoss}</span>}
              {en.takeProfit && <span className="text-sm text-gray-500">TP {en.takeProfit}</span>}
              <span className={`ml-auto font-semibold ${resultColor[en.result]}`}>
                {resultLabel[en.result]}{en.pnl != null && ` (${en.pnl > 0 ? '+' : ''}${en.pnl}$)`}
              </span>
              <button onClick={() => remove(en.id)} className="text-gray-500 hover:text-red-400">✕</button>
            </div>
            {(en.emotion || en.mistakes || en.notes) && (
              <div className="text-sm text-gray-400 mt-2 space-y-1">
                {en.emotion && <div>😐 Cảm xúc: {en.emotion}</div>}
                {en.mistakes && <div>⚠️ Lỗi: {en.mistakes}</div>}
                {en.notes && <div>📝 {en.notes}</div>}
              </div>
            )}
            {(en.imageBefore || en.imageAfter) && (
              <div className="flex gap-3 mt-3">
                {en.imageBefore && (
                  <a href={uploadsUrl(en.imageBefore)} target="_blank" rel="noreferrer">
                    <img src={uploadsUrl(en.imageBefore)} alt="Trước" className="h-28 rounded-lg border border-border" />
                  </a>
                )}
                {en.imageAfter && (
                  <a href={uploadsUrl(en.imageAfter)} target="_blank" rel="noreferrer">
                    <img src={uploadsUrl(en.imageAfter)} alt="Sau" className="h-28 rounded-lg border border-border" />
                  </a>
                )}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-2">{new Date(en.openedAt).toLocaleString('vi-VN')}</div>
          </div>
        ))}
        {entries.length === 0 && !showForm && (
          <div className="card text-gray-500 text-center py-8">Chưa có lệnh nào trong nhật ký.</div>
        )}
      </div>
    </AppShell>
  );
}
