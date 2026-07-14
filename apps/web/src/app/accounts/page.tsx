'use client';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type Account = {
  id: string; label: string; login: string; server: string;
  broker?: string; currency: string; balance: number; isDefault: boolean;
};

const empty = { label: '', login: '', server: '', broker: '', currency: 'USD', balance: 0 };

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [showForm, setShowForm] = useState(false);

  const load = () => api<Account[]>('/mt5-accounts').then(setAccounts);
  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await api('/mt5-accounts', {
      method: 'POST',
      body: JSON.stringify({ ...form, balance: Number(form.balance) }),
    });
    setForm({ ...empty });
    setShowForm(false);
    load();
  }

  async function setDefault(id: string) {
    await api(`/mt5-accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Xóa tài khoản này?')) return;
    await api(`/mt5-accounts/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Tài khoản MT5</h1>
        <button className="btn" onClick={() => setShowForm(!showForm)}>{showForm ? 'Đóng' : '+ Thêm tài khoản'}</button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <input className="input" placeholder="Tên gợi nhớ (VD: Tài khoản chính)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
          <input className="input" placeholder="Số tài khoản MT5" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} required />
          <input className="input" placeholder="Server (VD: Exness-MT5Real)" value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} required />
          <input className="input" placeholder="Broker" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} />
          <input className="input" placeholder="Số dư" type="number" step="0.01" value={form.balance} onChange={(e) => setForm({ ...form, balance: +e.target.value })} />
          <button className="btn">Lưu</button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((a) => (
          <div key={a.id} className={`card ${a.isDefault ? 'border-accent' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="font-semibold">{a.label}</div>
              {a.isDefault && <span className="text-xs text-accent">Mặc định</span>}
            </div>
            <div className="text-sm text-gray-400 mt-2 space-y-1">
              <div>Login: {a.login}</div>
              <div>Server: {a.server}</div>
              {a.broker && <div>Broker: {a.broker}</div>}
            </div>
            <div className="text-xl font-bold mt-2">{a.balance.toLocaleString()} {a.currency}</div>
            <div className="flex gap-2 mt-3 text-sm">
              {!a.isDefault && <button onClick={() => setDefault(a.id)} className="text-accent">Đặt mặc định</button>}
              <button onClick={() => remove(a.id)} className="text-red-400 ml-auto">Xóa</button>
            </div>
          </div>
        ))}
        {accounts.length === 0 && !showForm && (
          <div className="card text-gray-500 col-span-full text-center py-8">Chưa có tài khoản MT5 nào.</div>
        )}
      </div>
    </AppShell>
  );
}
