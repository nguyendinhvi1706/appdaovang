'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };
type Setup = {
  id: string; symbol: string; direction: 'BUY' | 'SELL';
  entry: number; sl: number; tp: number; rr: number;
  reasoning: string; source: string; status: 'PENDING' | 'RUNNING' | 'WIN' | 'LOSS' | 'CANCELLED';
  createdAt: string; triggeredAt?: string; closedAt?: string;
};

const suggestions = [
  'Phân tích XAUUSD',
  'Xu hướng vàng hôm nay?',
  'Có vùng Supply/Demand nào trên XAUUSD không?',
  'Nên đặt SL TP ở đâu nếu buy XAUUSD?',
  'Risk 2% thì lot bao nhiêu với SL 30 pips?',
];

const statusMeta: Record<Setup['status'], [string, string]> = {
  PENDING: ['⏳ Chờ khớp entry', 'text-yellow-400 border-yellow-400/40'],
  RUNNING: ['▶️ Đang chạy', 'text-blue-400 border-blue-400/40'],
  WIN: ['✅ Thắng (chạm TP)', 'text-green-400 border-green-400/40'],
  LOSS: ['❌ Thua (chạm SL)', 'text-red-400 border-red-400/40'],
  CANCELLED: ['🚫 Đã hủy', 'text-gray-500 border-border'],
};

function ChatTab() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await api<{ reply: string }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: next }),
      });
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch (err: any) {
      setMessages([...next, { role: 'assistant', content: `❌ ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {messages.length === 0 && (
          <div className="card text-center py-8">
            <p className="text-gray-400 mb-4">Hỏi mình về thị trường, ví dụ:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="px-3 py-1.5 rounded-full border border-border text-sm hover:border-accent hover:text-accent transition">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed ${
              m.role === 'user' ? 'bg-accent text-black' : 'bg-panel border border-border'
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-panel border border-border rounded-2xl px-4 py-3 text-sm text-gray-400">
              Đang phân tích dữ liệu thị trường...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 mt-4">
        <input className="input" placeholder="Hỏi AI Trader... (VD: Phân tích XAUUSD)"
          value={input} onChange={(e) => setInput(e.target.value)} disabled={loading} />
        <button className="btn shrink-0" disabled={loading || !input.trim()}>Gửi</button>
      </form>
    </div>
  );
}

function SetupsTab() {
  const [setups, setSetups] = useState<Setup[]>([]);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setSetups(await api<Setup[]>('/ai/setups'));
    } catch {} finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    setCreating(true); setError('');
    try {
      await api('/ai/setup', { method: 'POST', body: JSON.stringify({ symbol }) });
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function cancel(id: string) {
    await api(`/ai/setups/${id}/cancel`, { method: 'PATCH' });
    load();
  }

  const closed = setups.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
  const wins = closed.filter((s) => s.status === 'WIN').length;

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="card mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select className="input w-auto" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTC-USD'].map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="btn" onClick={create} disabled={creating}>
            {creating ? '🤖 AI đang phân tích...' : '🎯 Tạo setup mới'}
          </button>
          <button className="px-3 py-2 rounded-lg border border-border hover:border-accent text-sm"
            onClick={load} disabled={refreshing}>
            {refreshing ? 'Đang cập nhật...' : '🔄 Cập nhật kết quả'}
          </button>
          {closed.length > 0 && (
            <span className="text-sm text-gray-400 ml-auto">
              Thành tích AI: <b className="text-accent">{wins}W/{closed.length - wins}L</b> ({closed.length ? Math.round((wins / closed.length) * 100) : 0}% win)
            </span>
          )}
        </div>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
        <p className="text-xs text-gray-500 mt-2">
          AI đề xuất Entry/SL/TP từ dữ liệu thật → hệ thống tự theo dõi giá: khớp entry → đang chạy → chạm TP thắng / chạm SL thua. Không đặt lệnh thật.
        </p>
      </div>

      <div className="space-y-3">
        {setups.map((s) => {
          const [label, cls] = statusMeta[s.status];
          const slPct = Math.abs(s.entry - s.sl);
          const tpPct = Math.abs(s.tp - s.entry);
          return (
            <div key={s.id} className="card">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">{s.symbol}</span>
                <span className={`font-semibold ${s.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                  {s.direction === 'BUY' ? '▲ BUY' : '▼ SELL'}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
                {s.source === 'ALGO' && <span className="text-xs text-gray-500">(thuật toán)</span>}
                <span className="text-xs text-gray-500 ml-auto">{new Date(s.createdAt).toLocaleString('vi-VN')}</span>
                {(s.status === 'PENDING' || s.status === 'RUNNING') && (
                  <button onClick={() => cancel(s.id)} className="text-gray-500 hover:text-red-400 text-sm">Hủy</button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                <div className="bg-surface rounded-lg p-2 border border-border">
                  <div className="text-xs text-gray-500">Entry</div>
                  <div className="font-bold">{s.entry}</div>
                </div>
                <div className="bg-surface rounded-lg p-2 border border-red-400/30">
                  <div className="text-xs text-gray-500">Stop Loss</div>
                  <div className="font-bold text-red-400">{s.sl} <span className="text-xs font-normal">(-{slPct.toFixed(2)})</span></div>
                </div>
                <div className="bg-surface rounded-lg p-2 border border-green-400/30">
                  <div className="text-xs text-gray-500">Take Profit</div>
                  <div className="font-bold text-green-400">{s.tp} <span className="text-xs font-normal">(+{tpPct.toFixed(2)})</span></div>
                </div>
                <div className="bg-surface rounded-lg p-2 border border-border">
                  <div className="text-xs text-gray-500">RR</div>
                  <div className="font-bold text-accent">1 : {s.rr}</div>
                </div>
              </div>
              <button className="text-sm text-accent mt-2" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                {expanded === s.id ? 'Ẩn lý do ▲' : 'Xem lý do ▼'}
              </button>
              {expanded === s.id && (
                <p className="text-sm text-gray-400 mt-1 whitespace-pre-wrap">{s.reasoning}</p>
              )}
            </div>
          );
        })}
        {setups.length === 0 && (
          <div className="card text-center text-gray-500 py-10">Chưa có setup nào — bấm "Tạo setup mới" để AI phân tích và đề xuất lệnh.</div>
        )}
      </div>
    </div>
  );
}

export default function AiPage() {
  const [tab, setTab] = useState<'chat' | 'setups'>('chat');
  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-3rem)]">
        <div className="flex items-center gap-4 mb-2 flex-wrap">
          <h1 className="text-2xl font-bold">🤖 AI Trader</h1>
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button onClick={() => setTab('chat')}
              className={`px-4 py-1.5 text-sm ${tab === 'chat' ? 'bg-accent text-black font-semibold' : 'hover:bg-panel'}`}>
              💬 Chat
            </button>
            <button onClick={() => setTab('setups')}
              className={`px-4 py-1.5 text-sm ${tab === 'setups' ? 'bg-accent text-black font-semibold' : 'hover:bg-panel'}`}>
              🎯 Setup lệnh
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          Phân tích thị trường bằng dữ liệu thật — AI không tự đặt lệnh.
        </p>
        {tab === 'chat' ? <ChatTab /> : <SetupsTab />}
      </div>
    </AppShell>
  );
}
