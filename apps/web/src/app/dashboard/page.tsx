'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import GoldPrice from '@/components/GoldPrice';
import TradingViewChart from '@/components/TradingViewChart';
import { api } from '@/lib/api';

type Stats = { total: number; open: number; wins: number; losses: number; winRate: number; totalPnl: number };

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    api<Stats>('/journal/stats').then(setStats).catch(() => {});
    api<any[]>('/mt5-accounts').then(setAccounts).catch(() => {});
  }, []);

  return (
    <AppShell>
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <GoldPrice />
        <div className="card">
          <div className="text-sm text-gray-400">Nhật ký giao dịch</div>
          <div className="text-3xl font-bold mt-1">{stats ? `${stats.winRate}%` : '...'}</div>
          <div className="text-sm text-gray-400 mt-1">
            Win rate · {stats?.wins ?? 0}W / {stats?.losses ?? 0}L · PnL: {stats?.totalPnl ?? 0}
          </div>
        </div>
        <div className="card">
          <div className="text-sm text-gray-400">Tài khoản MT5</div>
          <div className="text-3xl font-bold mt-1">{accounts.length}</div>
          <Link href="/accounts" className="text-sm text-accent mt-1 inline-block">Quản lý →</Link>
        </div>
      </div>
      <div className="card p-0"
        style={{ resize: 'both', overflow: 'hidden', height: 480, minHeight: 260, minWidth: 320, maxWidth: '100%' }}>
        <TradingViewChart />
      </div>
    </AppShell>
  );
}
