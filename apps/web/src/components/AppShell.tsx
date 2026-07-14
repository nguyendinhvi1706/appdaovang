'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getToken, logout } from '@/lib/api';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/ai', label: 'AI Trader', icon: '🤖' },
  { href: '/chart', label: 'Biểu đồ', icon: '📈' },
  { href: '/smc', label: 'SMC', icon: '🧠' },
  { href: '/backtest', label: 'Backtest', icon: '🧪' },
  { href: '/replay', label: 'Replay', icon: '⏯️' },
  { href: '/watchlist', label: 'Watchlist', icon: '⭐' },
  { href: '/accounts', label: 'Tài khoản MT5', icon: '💼' },
  { href: '/journal', label: 'Nhật ký', icon: '📓' },
  { href: '/risk', label: 'Risk Manager', icon: '🛡️' },
  { href: '/community', label: 'Cộng đồng', icon: '🌍' },
  { href: '/marketplace', label: 'Marketplace', icon: '🛒' },
  { href: '/calendar', label: 'Lịch kinh tế', icon: '🗓️' },
  { href: '/news', label: 'Tin tức', icon: '📰' },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1 flex-1 overflow-y-auto">
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          onClick={onNavigate}
          className={`block px-3 py-2 rounded-lg text-sm hover:bg-surface transition ${
            pathname === n.href ? 'bg-surface text-accent font-semibold' : ''
          }`}
        >
          {n.icon} {n.label}
        </Link>
      ))}
    </nav>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="flex min-h-screen">
      {/* Sidebar desktop */}
      <aside className="w-56 shrink-0 border-r border-border bg-panel p-4 hidden md:flex flex-col">
        <div className="text-lg font-bold text-accent mb-6">🥇 AppDaoVang</div>
        <NavLinks />
        <button onClick={logout} className="text-sm text-gray-400 hover:text-red-400 text-left px-3 py-2">
          🚪 Đăng xuất
        </button>
      </aside>

      {/* Drawer mobile */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-panel border-r border-border p-4 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <span className="text-lg font-bold text-accent">🥇 AppDaoVang</span>
              <button onClick={() => setOpen(false)} className="text-gray-400 text-xl px-2">✕</button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <button onClick={logout} className="text-sm text-gray-400 hover:text-red-400 text-left px-3 py-2">
              🚪 Đăng xuất
            </button>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar mobile */}
        <header className="md:hidden sticky top-0 z-40 flex items-center gap-3 px-4 py-3 bg-panel border-b border-border">
          <button onClick={() => setOpen(true)} className="text-xl" aria-label="Menu">☰</button>
          <span className="font-bold text-accent">🥇 AppDaoVang</span>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
