import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

type CacheEntry = { data: unknown; expires: number };

export type Candle = { time: number; open: number; high: number; low: number; close: number };

function aggregate(candles: Candle[], seconds: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else {
      out.push({ time: bucket, open: c.open, high: c.high, low: c.low, close: c.close });
    }
  }
  return out;
}


@Injectable()
export class MarketService {
  private cache = new Map<string, CacheEntry>();

  private async cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data as T;
    const data = await fn();
    this.cache.set(key, { data, expires: Date.now() + ttlMs });
    return data;
  }

  /** Giá spot realtime từ Swissquote (khớp TradingView) — hỗ trợ XAUUSD, XAGUSD, EURUSD... */
  private async swissquoteSpot(symbol: string) {
    const base = symbol.slice(0, 3), quote = symbol.slice(3);
    const url = `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${base}/${quote}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Swissquote ${res.status}`);
    const json: any = await res.json();
    const prices = json?.[0]?.spreadProfilePrices?.[0];
    if (!prices) throw new Error('Swissquote: no data');
    const mid = (prices.bid + prices.ask) / 2;
    return {
      symbol,
      price: +mid.toFixed(symbol.startsWith('XAU') ? 2 : 5),
      bid: prices.bid,
      ask: prices.ask,
      previousClose: null as number | null,
      change: null as number | null,
      currency: quote,
      source: 'swissquote',
      time: json?.[0] ? new Date(json[0].ts ?? Date.now()).toISOString() : null,
    };
  }

  /** Fallback: Yahoo Finance */
  private async yahooQuote(symbol: string) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Yahoo Finance ${res.status}`);
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    return {
      symbol,
      price: meta?.regularMarketPrice ?? null,
      bid: null as number | null,
      ask: null as number | null,
      previousClose: meta?.chartPreviousClose ?? null,
      change: meta?.regularMarketPrice != null && meta?.chartPreviousClose != null
        ? +(meta.regularMarketPrice - meta.chartPreviousClose).toFixed(4)
        : null,
      currency: meta?.currency ?? 'USD',
      source: 'yahoo',
      time: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    };
  }

  quote(symbol: string) {
    const clean = symbol.replace('=X', '').toUpperCase();
    return this.cached(`quote:${clean}`, 10_000, async () => {
      // Cặp 6 ký tự (FX/kim loại): ưu tiên Swissquote spot, fallback Yahoo
      if (/^[A-Z]{6}$/.test(clean)) {
        try {
          return await this.swissquoteSpot(clean);
        } catch {
          return this.yahooQuote(`${clean}=X`);
        }
      }
      return this.yahooQuote(symbol);
    });
  }


  /** Nến OHLC từ Yahoo Finance — dùng chung cho AI Trader và SMC engine */
  candles(symbol: string, interval: '5m' | '15m' | '30m' | '1h' | '4h' | '1d' = '1h'): Promise<Candle[]> {
    const ranges: Record<string, string> = { '5m': '5d', '15m': '5d', '30m': '1mo', '1h': '1mo', '4h': '3mo', '1d': '6mo' };
    const yInterval = interval === '4h' ? '1h' : interval; // Yahoo không có 4h, gộp từ 1h
    return this.cached(`candles:${symbol}:${interval}`, 60_000, async () => {
      const clean = symbol.replace('=X', '').toUpperCase();
      // Chuỗi fallback: vàng/bạc dùng futures COMEX khi =X không có dữ liệu
      const candidates: string[] =
        clean === 'XAUUSD' ? ['XAUUSD=X', 'GC=F']
        : clean === 'XAGUSD' ? ['XAGUSD=X', 'SI=F']
        : /^[A-Z]{6}$/.test(clean) ? [`${clean}=X`]
        : [symbol];

      let best: Candle[] | null = null;
      for (const y of candidates) {
        for (const host of ['query1', 'query2']) {
          try {
            const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(y)}?interval=${yInterval}&range=${ranges[interval]}`;
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
            if (!res.ok) {
              console.warn(`[candles] ${y} @${host}: HTTP ${res.status}`);
              continue;
            }
            const json: any = await res.json();
            const r = json?.chart?.result?.[0];
            const q = r?.indicators?.quote?.[0];
            if (!r?.timestamp || !q) {
              console.warn(`[candles] ${y} @${host}: không có dữ liệu`, JSON.stringify(json?.chart?.error ?? '').slice(0, 150));
              continue;
            }
            let out: Candle[] = r.timestamp
              .map((t: number, i: number) => ({
                time: t, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i],
              }))
              .filter((c: Candle) => c.close != null && c.open != null);
            if (interval === '4h') out = aggregate(out, 4 * 3600);
            // Sort + khử timestamp trùng (Yahoo hay trả nến cuối trùng giờ) — chart sẽ từ chối dữ liệu nếu không xử lý
            out.sort((a, b) => a.time - b.time);
            out = out.filter((x, i) => i === 0 || x.time !== out[i - 1].time);
            if (out.length >= 30) {
              // Nến phải TƯƠI — nguồn treo/trễ sẽ làm EMA tính sai xu hướng
              const maxAge: Record<string, number> = { '5m': 3 * 3600, '15m': 3 * 3600, '30m': 6 * 3600, '1h': 12 * 3600, '4h': 24 * 3600, '1d': 4 * 86400 };
              const ageSec = Date.now() / 1000 - out[out.length - 1].time;
              if (ageSec <= (maxAge[interval] ?? 12 * 3600)) return out.slice(-500);
              if (!best || out[out.length - 1].time > best[best.length - 1].time) best = out;
              console.warn(`[candles] ${y} @${host}: nến trễ ${(ageSec / 3600).toFixed(1)}h — thử nguồn khác`);
            }
          } catch (e: any) {
            console.warn(`[candles] ${y} @${host}: ${e.message}`);
          }
        }
      }
      // Không nguồn nào tươi (VD: cuối tuần thị trường đóng cửa) → trả nguồn mới nhất có được
      return best ? best.slice(-500) : [];
    });
  }

  gold() {
    return this.quote('XAUUSD');
  }

  /** Tin tức Forex từ RSS FXStreet */
  news() {
    return this.cached('news', 5 * 60_000, async () => {
      const res = await fetch('https://www.fxstreet.com/rss/news', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) throw new Error(`RSS ${res.status}`);
      const xml = await res.text();
      const parsed = new XMLParser().parse(xml);
      const items = parsed?.rss?.channel?.item ?? [];
      return (Array.isArray(items) ? items : [items]).slice(0, 30).map((i: any) => ({
        title: i.title,
        link: i.link,
        pubDate: i.pubDate,
        description: typeof i.description === 'string' ? i.description.slice(0, 300) : '',
      }));
    });
  }
}
