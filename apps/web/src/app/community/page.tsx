'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type Item = {
  id: string; type: string; title: string; description?: string; content: string;
  downloads: number; createdAt: string; author: string;
  isMine: boolean; likeCount: number; likedByMe: boolean;
};

const TYPES = [
  ['', 'Tất cả'], ['STRATEGY', 'Chiến lược'], ['TEMPLATE', 'Template'],
  ['INDICATOR', 'Indicator'], ['JOURNAL', 'Journal'], ['BACKTEST', 'Backtest'],
] as const;
const typeLabel = Object.fromEntries(TYPES);
const typeIcon: Record<string, string> = {
  STRATEGY: '♟️', TEMPLATE: '📋', INDICATOR: '📊', JOURNAL: '📓', BACKTEST: '🧪',
};

export default function CommunityPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'STRATEGY', title: '', description: '', content: '' });
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (q) params.set('q', q);
    api<Item[]>(`/shared?${params}`).then(setItems).catch(() => {});
  }, [type, q]);

  useEffect(() => { load(); }, [load]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api('/shared', { method: 'POST', body: JSON.stringify(form) });
      setForm({ type: 'STRATEGY', title: '', description: '', content: '' });
      setShowForm(false);
      load();
    } finally {
      setLoading(false);
    }
  }

  async function toggleLike(it: Item) {
    setItems((prev) => prev.map((x) => x.id === it.id
      ? { ...x, likedByMe: !x.likedByMe, likeCount: x.likeCount + (x.likedByMe ? -1 : 1) }
      : x));
    await api(`/shared/${it.id}/like`, { method: 'POST' }).catch(() => load());
  }

  async function remove(id: string) {
    if (!confirm('Xóa bài chia sẻ này?')) return;
    await api(`/shared/${id}`, { method: 'DELETE' });
    load();
  }

  /** Backtest/Strategy có config JSON → áp dụng thẳng vào trang Backtest */
  function parseConfig(it: Item): Record<string, unknown> | null {
    if (it.type !== 'BACKTEST' && it.type !== 'STRATEGY') return null;
    try {
      const json = JSON.parse(it.content);
      const cfg = json.config ?? json;
      return cfg && typeof cfg === 'object' && cfg.strategy ? cfg : null;
    } catch { return null; }
  }

  async function apply(it: Item) {
    const cfg = parseConfig(it);
    if (!cfg) return;
    await api(`/shared/${it.id}/use`, { method: 'POST' }).catch(() => {});
    localStorage.setItem('backtest-import', JSON.stringify(cfg));
    router.push('/backtest');
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-2xl font-bold">🌍 Cộng đồng</h1>
        <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? 'Đóng' : '📤 Chia sẻ mới'}</button>
      </div>

      {showForm && (
        <form onSubmit={publish} className="card space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className="input md:col-span-2" placeholder="Tiêu đề" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={150} />
          </div>
          <input className="input" placeholder="Mô tả ngắn" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={1000} />
          <textarea className="input font-mono text-sm" rows={8} required maxLength={50000}
            placeholder={'Nội dung chia sẻ:\n- Chiến lược: mô tả quy tắc vào/thoát lệnh, hoặc JSON config backtest\n- Indicator: code Pine Script / công thức\n- Template: cấu hình, checklist...'}
            value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <button className="btn" disabled={loading}>{loading ? 'Đang đăng...' : 'Đăng chia sẻ'}</button>
        </form>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {TYPES.map(([v, l]) => (
            <button key={v} onClick={() => setType(v)}
              className={`px-3 py-1.5 text-sm ${type === v ? 'bg-accent text-black font-semibold' : 'hover:bg-panel'}`}>
              {l}
            </button>
          ))}
        </div>
        <input className="input w-56" placeholder="Tìm kiếm..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.id} className="card">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg">{typeIcon[it.type]}</span>
              <span className="font-bold">{it.title}</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-border text-gray-400">{typeLabel[it.type as keyof typeof typeLabel] ?? it.type}</span>
              <span className="text-sm text-gray-500">bởi {it.author}{it.isMine && ' (bạn)'}</span>
              <div className="ml-auto flex items-center gap-3 text-sm">
                <button onClick={() => toggleLike(it)} className={it.likedByMe ? 'text-red-400' : 'text-gray-400 hover:text-red-400'}>
                  {it.likedByMe ? '❤️' : '🤍'} {it.likeCount}
                </button>
                <span className="text-gray-500">⬇ {it.downloads}</span>
                {it.isMine && <button onClick={() => remove(it.id)} className="text-gray-500 hover:text-red-400">✕</button>}
              </div>
            </div>
            {it.description && <p className="text-sm text-gray-400 mt-1">{it.description}</p>}
            <div className="flex gap-2 mt-2">
              <button className="text-sm text-accent" onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
                {expanded === it.id ? 'Thu gọn ▲' : 'Xem nội dung ▼'}
              </button>
              {parseConfig(it) && (
                <button className="text-sm text-green-400" onClick={() => apply(it)}>▶ Chạy backtest này</button>
              )}
            </div>
            {expanded === it.id && (
              <pre className="mt-2 p-3 bg-surface rounded-lg text-xs overflow-x-auto whitespace-pre-wrap border border-border">{it.content}</pre>
            )}
            <div className="text-xs text-gray-500 mt-2">{new Date(it.createdAt).toLocaleString('vi-VN')}</div>
          </div>
        ))}
        {items.length === 0 && (
          <div className="card text-center text-gray-500 py-10">Chưa có bài chia sẻ nào — hãy là người đầu tiên! 🚀</div>
        )}
      </div>
    </AppShell>
  );
}
