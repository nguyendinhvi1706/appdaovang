'use client';
import { useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type NewsItem = { title: string; link: string; pubDate: string; description: string };

export default function NewsPage() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<NewsItem[]>('/market/news')
      .then(setNews)
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <h1 className="text-2xl font-bold mb-4">Tin tức Forex</h1>
      {loading && <p className="text-gray-400">Đang tải...</p>}
      <div className="space-y-3">
        {news.map((n, i) => (
          <a key={i} href={n.link} target="_blank" rel="noreferrer" className="card block hover:border-accent transition">
            <div className="font-semibold">{n.title}</div>
            <div className="text-sm text-gray-400 mt-1">{n.description}</div>
            <div className="text-xs text-gray-500 mt-2">{new Date(n.pubDate).toLocaleString('vi-VN')}</div>
          </a>
        ))}
      </div>
    </AppShell>
  );
}
