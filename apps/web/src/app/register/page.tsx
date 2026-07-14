'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api('/auth/register', { method: 'POST', body: JSON.stringify(form) });
      localStorage.setItem('token', res.accessToken);
      localStorage.setItem('user', JSON.stringify(res.user));
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-bold text-accent">Tạo tài khoản</h1>
        <input className="input" placeholder="Tên của bạn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="input" type="password" placeholder="Mật khẩu (tối thiểu 6 ký tự)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn w-full" disabled={loading}>{loading ? 'Đang tạo...' : 'Đăng ký'}</button>
        <p className="text-sm text-gray-400">
          Đã có tài khoản? <Link href="/login" className="text-accent">Đăng nhập</Link>
        </p>
      </form>
    </div>
  );
}
