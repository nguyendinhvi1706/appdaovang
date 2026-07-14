'use client';
import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api, uploadsUrl } from '@/lib/api';

type Item = {
  id: string; category: string; title: string; description?: string; content: string;
  fileUrl?: string; fileName?: string; version: string; downloads: number;
  createdAt: string; author: string; isMine: boolean;
  ratingCount: number; avgRating: number | null; myRating: number | null;
};

const CATS = [
  ['', 'Tất cả', '🛒'], ['INDICATOR', 'Indicator', '📊'], ['EA', 'EA', '🤖'],
  ['TEMPLATE', 'Template', '📋'], ['SCRIPT', 'Script', '📜'],
  ['AI_PROMPT', 'AI Prompt', '💬'], ['JOURNAL', 'Trading Journal', '📓'],
] as const;
const catLabel: Record<string, string> = Object.fromEntries(CATS.map(([v, l]) => [v, l]));
const catIcon: Record<string, string> = Object.fromEntries(CATS.map(([v, , i]) => [v, i]));

function Stars({ value, onRate }: { value: number | null; onRate: (s: number) => void }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} onClick={() => onRate(s)} title={`${s} sao`}
          className={`text-sm ${value != null && s <= value ? 'text-accent' : 'text-gray-600'} hover:text-accent`}>
          ★
        </button>
      ))}
    </span>
  );
}

export default function MarketplacePage() {
  const [items, setItems] = useState<Item[]>([]);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (cat) params.set('category', cat);
    if (q) params.set('q', q);
    api<Item[]>(`/marketplace?${params}`).then(setItems).catch(() => {});
  }, [cat, q]);

  useEffect(() => { load(); }, [load]);

  async function publish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const fd = new FormData(e.currentTarget);
      const file = fd.get('file') as File | null;
      if (file && file.size === 0) fd.delete('file');
      await api('/marketplace', { method: 'POST', body: fd });
      setShowForm(false);
      load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function rate(it: Item, stars: number) {
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, myRating: stars } : x));
    await api(`/marketplace/${it.id}/rate`, { method: 'POST', body: JSON.stringify({ stars }) }).then(load).catch(() => {});
  }

  async function download(it: Item) {
    const res = await api<{ fileUrl?: string; content: string }>(`/marketplace/${it.id}/download`, { method: 'POST' });
    if (res.fileUrl) {
      window.open(uploadsUrl(res.fileUrl), '_blank');
    } else if (it.category === 'AI_PROMPT') {
      await navigator.clipboard.writeText(res.content);
      setCopied(it.id);
      setTimeout(() => setCopied(null), 2000);
    } else {
      setExpanded(it.id);
    }
    load();
  }

  async function remove(id: string) {
    if (!confirm('Xóa sản phẩm này?')) return;
    await api(`/marketplace/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h1 className="text-2xl font-bold">🛒 Marketplace</h1>
        <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? 'Đóng' : '+ Đăng sản phẩm'}</button>
      </div>
      <p className="text-sm text-gray-400 mb-4">100% miễn phí — cộng đồng chia sẻ công cụ cho nhau.</p>

      {showForm && (
        <form onSubmit={publish} className="card space-y-3 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select className="input" name="category" required>
              {CATS.slice(1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className="input md:col-span-2" name="title" placeholder="Tên sản phẩm" required maxLength={150} />
            <input className="input" name="version" placeholder="Phiên bản (VD: 1.0)" maxLength={20} />
          </div>
          <input className="input" name="description" placeholder="Mô tả ngắn" maxLength={1000} />
          <textarea className="input font-mono text-sm" name="content" rows={6} required maxLength={50000}
            placeholder={'Nội dung:\n- Indicator/EA/Script: hướng dẫn cài đặt & sử dụng\n- AI Prompt: nội dung prompt\n- Template/Journal: cấu trúc, cách dùng'} />
          <label className="text-sm text-gray-400 block">
            File đính kèm (tùy chọn): .mq4 .mq5 .ex4 .ex5 .zip .txt .json .pine .py .csv .set .tpl — tối đa 10MB
            <input className="input mt-1" type="file" name="file"
              accept=".mq4,.mq5,.ex4,.ex5,.zip,.txt,.json,.pine,.py,.csv,.set,.tpl" />
          </label>
          <button className="btn" disabled={loading}>{loading ? 'Đang đăng...' : 'Đăng sản phẩm'}</button>
        </form>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="flex rounded-lg border border-border overflow-hidden flex-wrap">
          {CATS.map(([v, l, i]) => (
            <button key={v} onClick={() => setCat(v)}
              className={`px-3 py-1.5 text-sm ${cat === v ? 'bg-accent text-black font-semibold' : 'hover:bg-panel'}`}>
              {i} {l}
            </button>
          ))}
        </div>
        <input className="input w-56" placeholder="Tìm kiếm..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((it) => (
          <div key={it.id} className="card flex flex-col">
            <div className="flex items-start gap-2">
              <span className="text-2xl">{catIcon[it.category]}</span>
              <div className="min-w-0">
                <div className="font-bold truncate">{it.title} <span className="text-xs text-gray-500 font-normal">v{it.version}</span></div>
                <div className="text-xs text-gray-500">{catLabel[it.category]} · {it.author}{it.isMine && ' (bạn)'}</div>
              </div>
              {it.isMine && (
                <button onClick={() => remove(it.id)} className="ml-auto text-gray-500 hover:text-red-400">✕</button>
              )}
            </div>
            {it.description && <p className="text-sm text-gray-400 mt-2 line-clamp-2">{it.description}</p>}
            <div className="flex items-center gap-2 mt-2 text-sm">
              <Stars value={it.myRating} onRate={(s) => rate(it, s)} />
              <span className="text-gray-500">{it.avgRating != null ? `${it.avgRating} (${it.ratingCount})` : 'chưa có đánh giá'}</span>
              <span className="text-gray-500 ml-auto">⬇ {it.downloads}</span>
            </div>
            <div className="flex gap-2 mt-3 pt-3 border-t border-border">
              <button className="btn flex-1 text-sm py-1.5" onClick={() => download(it)}>
                {copied === it.id ? '✅ Đã copy' : it.fileUrl ? `⬇ Tải ${it.fileName ?? 'file'}` : it.category === 'AI_PROMPT' ? '📋 Copy prompt' : '📖 Xem'}
              </button>
              <button className="px-3 py-1.5 text-sm rounded-lg border border-border hover:border-accent"
                onClick={() => setExpanded(expanded === it.id ? null : it.id)}>
                {expanded === it.id ? '▲' : '▼'}
              </button>
            </div>
            {expanded === it.id && (
              <pre className="mt-2 p-3 bg-surface rounded-lg text-xs overflow-x-auto whitespace-pre-wrap border border-border max-h-64 overflow-y-auto">{it.content}</pre>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="card text-center text-gray-500 py-10 col-span-full">Chưa có sản phẩm nào trong mục này.</div>
        )}
      </div>
    </AppShell>
  );
}
