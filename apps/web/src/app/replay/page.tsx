'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type Candle = { time: number; open: number; high: number; low: number; close: number };
const speeds = [1, 2, 5, 10] as const;

export default function ReplayPage() {
  const chartRef = useRef<IChartApi | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const posRef = useRef(0);

  const [symbol, setSymbol] = useState('XAUUSD');
  const [interval, setIntervalV] = useState('1h');
  const [total, setTotal] = useState(0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(2);
  const [error, setError] = useState('');

  const render = useCallback((idx: number) => {
    const series = seriesRef.current;
    if (!series) return;
    try {
      const shown = candlesRef.current.slice(0, idx);
      series.setData(shown.map((c) => ({
        time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
      })));
      posRef.current = idx;
      setPos(idx);
    } catch (e: any) {
      console.error('[replay] render:', e);
      setError(`Lỗi vẽ chart: ${e.message}`);
    }
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPlaying(true);
    timerRef.current = setInterval(() => {
      if (posRef.current >= candlesRef.current.length) { stop(); return; }
      render(posRef.current + 1);
    }, 1000 / speed);
  }, [speed, render, stop]);

  useEffect(() => {
    if (playing) play(); // đổi tốc độ khi đang chạy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  const load = useCallback(async () => {
    stop(); setError('');
    try {
      const raw = await api<Candle[]>(`/market/candles/${symbol}?interval=${interval}`);
      const data = raw
        .filter((c) => c && c.open != null && c.close != null)
        .sort((a, b) => a.time - b.time)
        .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);
      if (!data.length) throw new Error('Không có dữ liệu nến.');
      candlesRef.current = data;
      setTotal(data.length);
      const start = Math.max(30, Math.floor(data.length * 0.2));
      posRef.current = start; // để initChart vẽ đúng vị trí nếu chart chưa sẵn sàng
      render(start);
      chartRef.current?.timeScale().fitContent();
    } catch (err: any) {
      setError(err.message);
    }
  }, [symbol, interval, render, stop]);

  // Callback ref: AppShell render null lúc check đăng nhập nên div chart xuất hiện
  // MUỘN hơn lần mount đầu — phải tạo chart đúng lúc div gắn vào DOM.
  const initChart = useCallback((el: HTMLDivElement | null) => {
    if (!el || chartRef.current) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: 'rgba(48,54,61,0.5)' }, horzLines: { color: 'rgba(48,54,61,0.5)' } },
      timeScale: { timeVisible: true, borderColor: '#30363d', rightOffset: 12 },
      rightPriceScale: { borderColor: '#30363d' },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    roRef.current = ro;
    // Nếu dữ liệu đã về trước khi chart sẵn sàng thì vẽ luôn
    if (candlesRef.current.length) {
      render(posRef.current || Math.max(30, Math.floor(candlesRef.current.length * 0.2)));
      chart.timeScale().fitContent();
    }
  }, [render]);

  useEffect(() => () => {
    roRef.current?.disconnect();
    chartRef.current?.remove();
    chartRef.current = null;
    seriesRef.current = null;
  }, []);

  useEffect(() => { load(); return stop; }, [load, stop]);

  const last = candlesRef.current[pos - 1];

  return (
    <AppShell>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h1 className="text-2xl font-bold">Replay</h1>
        <select className="input w-auto" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTC-USD'].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select className="input w-auto" value={interval} onChange={(e) => setIntervalV(e.target.value)}>
          {['5m', '15m', '30m', '1h', '4h', '1d'].map((x) => <option key={x}>{x}</option>)}
        </select>
        {last && (
          <span className="text-sm text-gray-400">
            {new Date(last.time * 1000).toLocaleString('vi-VN')} · Close: <b className="text-gray-200">{last.close.toFixed(2)}</b>
          </span>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      <div className="card p-0 relative overflow-hidden mb-3" style={{ height: 'calc(100vh - 240px)', minHeight: 400 }}>
        <div ref={initChart} className="absolute inset-0" />
      </div>

      <div className="card flex items-center gap-3 flex-wrap">
        <button className="btn" onClick={() => (playing ? stop() : play())}>
          {playing ? '⏸ Dừng' : '▶ Chạy'}
        </button>
        <button className="px-3 py-2 rounded-lg border border-border hover:border-accent" onClick={() => { stop(); render(Math.max(1, pos - 1)); }}>⏮ -1</button>
        <button className="px-3 py-2 rounded-lg border border-border hover:border-accent" onClick={() => { stop(); render(Math.min(total, pos + 1)); }}>+1 ⏭</button>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {speeds.map((sp) => (
            <button key={sp} onClick={() => setSpeed(sp)}
              className={`px-3 py-2 text-sm ${speed === sp ? 'bg-accent text-black font-semibold' : 'hover:bg-panel'}`}>
              {sp}x
            </button>
          ))}
        </div>
        <input type="range" min={1} max={total} value={pos} className="flex-1 min-w-40 accent-[#d4a017]"
          onChange={(e) => { stop(); render(+e.target.value); }} />
        <span className="text-sm text-gray-400 tabular-nums">{pos}/{total}</span>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        Tua chart về quá khứ rồi chạy từng nến để luyện kỹ năng đọc price action — thử đoán hướng trước khi bấm +1.
      </p>
    </AppShell>
  );
}
