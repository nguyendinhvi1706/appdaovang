'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineStyle, UTCTimestamp } from 'lightweight-charts';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Zone = { kind: 'OB' | 'FVG'; direction: 'bull' | 'bear'; top: number; bottom: number; fromTime: number; toTime: number | null; mitigated: boolean };
type EqLevel = { kind: 'EQH' | 'EQL'; price: number; times: number[] };
type FisherPoint = { time: number; fisher: number; signal: number };
type CyclicalExtreme = { time: number; type: 'high' | 'low'; fisher: number };
type SmcData = {
  candles: Candle[];
  events: { type: 'BOS' | 'CHOCH'; direction: 'bull' | 'bear'; time: number; price: number }[];
  orderBlocks: Zone[];
  fvgs: Zone[];
  eqLevels: EqLevel[];
  dealingRange: { high: number; low: number; eq: number; fromTime: number } | null;
  fisher: FisherPoint[];
  cyclicalExtremes: CyclicalExtreme[];
  fisherThreshold: number;
  spot?: number | null;
  offset?: number;
};

const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTC-USD'];
const intervals = ['5m', '15m', '30m', '1h', '4h', '1d'] as const;

// Session theo giờ UTC
const sessions = [
  { name: 'Á', from: 0, to: 7, color: 'rgba(59,130,246,0.06)' },
  { name: 'London', from: 7, to: 13, color: 'rgba(212,160,23,0.07)' },
  { name: 'New York', from: 13, to: 21, color: 'rgba(139,92,246,0.06)' },
];
const killZones = [
  { name: 'KZ Á', from: 0, to: 3 },
  { name: 'KZ London', from: 7, to: 10 },
  { name: 'KZ NY', from: 13, to: 16 },
];

const toggleDefs = [
  ['ob', 'Order Block'], ['fvg', 'FVG'], ['eq', 'EQH/EQL'], ['struct', 'BOS/CHOCH'],
  ['pd', 'Premium/Discount'], ['session', 'Session'], ['kz', 'Kill Zone'],
  ['fisher', 'Cyclical Extreme (Fisher)'],
] as const;

export default function SmcPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const dataRef = useRef<SmcData | null>(null);

  const [symbol, setSymbol] = useState('XAUUSD');
  const [interval, setIntervalV] = useState<(typeof intervals)[number]>('1h');
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    ob: true, fvg: true, eq: true, struct: true, pd: false, session: false, kz: false, fisher: false,
  });
  const togglesRef = useRef(toggles);
  togglesRef.current = toggles;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const draw = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    const canvas = canvasRef.current, container = containerRef.current;
    const data = dataRef.current;
    if (!chart || !series || !canvas || !container || !data) return;

    const w = container.clientWidth, h = container.clientHeight;
    canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px sans-serif';

    const ts = chart.timeScale();
    const x = (t: number | null): number | null => {
      if (t == null) return w;
      const coord = ts.timeToCoordinate(t as UTCTimestamp);
      return coord == null ? null : coord;
    };
    const xc = (t: number | null, fallback: number): number => x(t) ?? fallback;
    const y = (p: number) => series.priceToCoordinate(p) ?? -100;
    const tg = togglesRef.current;

    // Session / Kill Zone (vẽ theo từng nến, chỉ khung <= 1h)
    if ((tg.session || tg.kz) && ['5m', '15m', '30m', '1h'].includes(interval)) {
      const candles = data.candles;
      const step = candles.length > 1 ? (xc(candles[1].time, 0) - xc(candles[0].time, 0)) || 4 : 4;
      for (const c of candles) {
        const cx = x(c.time);
        if (cx == null) continue;
        const hour = new Date(c.time * 1000).getUTCHours();
        if (tg.session) {
          const s = sessions.find((s) => hour >= s.from && hour < s.to);
          if (s) { ctx.fillStyle = s.color; ctx.fillRect(cx - step / 2, 0, step, h); }
        }
        if (tg.kz) {
          const k = killZones.find((k) => hour >= k.from && hour < k.to);
          if (k) { ctx.fillStyle = 'rgba(239,68,68,0.07)'; ctx.fillRect(cx - step / 2, 0, step, h); }
        }
      }
    }

    // Premium / Discount
    if (tg.pd && data.dealingRange) {
      const { high, low, eq, fromTime } = data.dealingRange;
      const x0 = xc(fromTime, 0);
      ctx.fillStyle = 'rgba(239,68,68,0.08)';
      ctx.fillRect(x0, y(high), w - x0, y(eq) - y(high));
      ctx.fillStyle = 'rgba(34,197,94,0.08)';
      ctx.fillRect(x0, y(eq), w - x0, y(low) - y(eq));
      ctx.strokeStyle = 'rgba(156,163,175,0.6)'; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x0, y(eq)); ctx.lineTo(w, y(eq)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#9ca3af';
      ctx.fillText('Premium', x0 + 4, y(high) + 12);
      ctx.fillText('Discount', x0 + 4, y(low) - 4);
      ctx.fillText('EQ 50%', x0 + 4, y(eq) - 4);
    }

    // Order Blocks + FVG
    const zones: Zone[] = [...(tg.ob ? data.orderBlocks : []), ...(tg.fvg ? data.fvgs : [])];
    for (const z of zones) {
      const x0 = x(z.fromTime);
      if (x0 == null) continue;
      const x1 = z.toTime ? xc(z.toTime, w) : w;
      const yTop = y(z.top), yBot = y(z.bottom);
      const bull = z.direction === 'bull';
      const alpha = z.mitigated ? 0.06 : 0.16;
      ctx.fillStyle = z.kind === 'OB'
        ? (bull ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`)
        : (bull ? `rgba(59,130,246,${alpha})` : `rgba(249,115,22,${alpha})`);
      ctx.fillRect(x0, yTop, Math.max(x1 - x0, 2), yBot - yTop);
      if (!z.mitigated) {
        ctx.fillStyle = 'rgba(156,163,175,0.9)';
        ctx.fillText(`${z.kind}${bull ? '+' : '-'}`, x0 + 2, yTop + 10);
      }
    }

    // EQH / EQL — thanh khoản
    if (tg.eq) {
      for (const lv of data.eqLevels) {
        const x0 = xc(Math.min(...lv.times), 0);
        const py = y(lv.price);
        ctx.strokeStyle = lv.kind === 'EQH' ? 'rgba(239,68,68,0.8)' : 'rgba(34,197,94,0.8)';
        ctx.setLineDash([6, 3]);
        ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(w, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = lv.kind === 'EQH' ? '#ef4444' : '#22c55e';
        ctx.fillText(`${lv.kind} $$$`, w - 64, py - 3);
      }
    }

    // Cyclical Extreme (Fisher Transform) — dải oscillator riêng ở đáy chart, dùng chung trục x
    if (tg.fisher && data.fisher.length) {
      const stripH = h * 0.22;
      const stripTop = h - stripH - 6;
      const stripBottom = h - 6;
      const midY = (stripTop + stripBottom) / 2;
      const threshold = data.fisherThreshold || 1.2;
      const maxAbs = Math.max(threshold + 0.3, ...data.fisher.map((f) => Math.abs(f.fisher)));
      const scaleY = (stripH / 2) / maxAbs;
      const yF = (v: number) => midY - v * scaleY;

      ctx.fillStyle = 'rgba(13,17,23,0.88)';
      ctx.fillRect(0, stripTop, w, stripH);
      ctx.strokeStyle = 'rgba(48,54,61,0.9)';
      ctx.beginPath(); ctx.moveTo(0, stripTop); ctx.lineTo(w, stripTop); ctx.stroke();

      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = 'rgba(156,163,175,0.4)';
      ctx.beginPath(); ctx.moveTo(0, yF(0)); ctx.lineTo(w, yF(0)); ctx.stroke();
      ctx.strokeStyle = 'rgba(239,68,68,0.4)';
      ctx.beginPath(); ctx.moveTo(0, yF(threshold)); ctx.lineTo(w, yF(threshold)); ctx.stroke();
      ctx.strokeStyle = 'rgba(34,197,94,0.4)';
      ctx.beginPath(); ctx.moveTo(0, yF(-threshold)); ctx.lineTo(w, yF(-threshold)); ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#d4a017';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      let started = false;
      for (const f of data.fisher) {
        const cx = x(f.time);
        if (cx == null) continue;
        const cy = yF(f.fisher);
        if (!started) { ctx.moveTo(cx, cy); started = true; } else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
      ctx.lineWidth = 1;

      for (const e of data.cyclicalExtremes) {
        const cx = x(e.time);
        if (cx == null) continue;
        ctx.fillStyle = e.type === 'low' ? '#22c55e' : '#ef4444';
        ctx.beginPath(); ctx.arc(cx, yF(e.fisher), 3, 0, Math.PI * 2); ctx.fill();
      }

      ctx.fillStyle = '#9ca3af';
      ctx.fillText(`Cyclical Extreme (Fisher Transform, ngưỡng ±${threshold})`, 6, stripTop + 12);
    }
  }, [interval]);

  const applyData = useCallback(() => {
    const data = dataRef.current, series = seriesRef.current, chart = chartRef.current;
    if (!data || !series || !chart) return;
    series.setData(data.candles.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    series.setMarkers(togglesRef.current.struct ? data.events.map((e) => ({
      time: e.time as UTCTimestamp,
      position: e.direction === 'bull' ? 'belowBar' as const : 'aboveBar' as const,
      color: e.type === 'CHOCH' ? '#eab308' : e.direction === 'bull' ? '#22c55e' : '#ef4444',
      shape: e.direction === 'bull' ? 'arrowUp' as const : 'arrowDown' as const,
      text: e.type,
    })) : []);
    chart.timeScale().fitContent();
    requestAnimationFrame(draw);
  }, [draw]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api<SmcData>(`/smc/${symbol}?interval=${interval}`);
      dataRef.current = data;
      applyData();
      setInfo(
        data.offset
          ? `Nến đã hiệu chỉnh ${data.offset > 0 ? '+' : ''}${data.offset.toFixed(2)} để khớp giá spot ${data.spot?.toFixed(2) ?? ''}`
          : data.spot != null ? `Khớp giá spot ${data.spot.toFixed(2)}` : '',
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, interval, applyData]);

  // Callback ref: tạo chart đúng lúc div xuất hiện (AppShell render null lúc check auth)
  const initChart = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    if (!el || chartRef.current) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: 'rgba(48,54,61,0.5)' }, horzLines: { color: 'rgba(48,54,61,0.5)' } },
      timeScale: { timeVisible: true, borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' },
      crosshair: { horzLine: { labelBackgroundColor: '#d4a017' }, vertLine: { labelBackgroundColor: '#d4a017' } },
    });
    const series = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    chart.timeScale().subscribeVisibleTimeRangeChange(() => requestAnimationFrame(draw));

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      requestAnimationFrame(draw);
    });
    ro.observe(el);
    roRef.current = ro;
    applyData(); // nếu dữ liệu đã về trước khi chart sẵn sàng
  }, [draw, applyData]);

  useEffect(() => () => {
    roRef.current?.disconnect();
    chartRef.current?.remove();
    chartRef.current = null;
    seriesRef.current = null;
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { requestAnimationFrame(draw); }, [toggles, draw]);

  return (
    <AppShell>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h1 className="text-2xl font-bold">SMC</h1>
        <select className="input w-auto" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          {symbols.map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {intervals.map((iv) => (
            <button key={iv} onClick={() => setIntervalV(iv)}
              className={`px-3 py-1.5 text-sm ${interval === iv ? 'bg-accent text-black font-semibold' : 'hover:bg-panel'}`}>
              {iv}
            </button>
          ))}
        </div>
        {loading && <span className="text-sm text-gray-400">Đang tải...</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
        {!loading && !error && info && <span className="text-xs text-gray-500">{info}</span>}
      </div>

      <div className="flex gap-3 flex-wrap mb-3 text-sm">
        {toggleDefs.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={toggles[key]}
              onChange={(e) => { setToggles({ ...toggles, [key]: e.target.checked }); if (key === 'struct') load(); }} />
            {label}
          </label>
        ))}
      </div>

      <div className="card p-0 relative overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 420 }}>
        <div ref={initChart} className="absolute inset-0" />
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
      </div>
      <p className="text-xs text-gray-500 mt-2">
        OB xanh/đỏ = Order Block bull/bear · FVG xanh dương/cam = Fair Value Gap · Nét đứt EQH/EQL = vùng thanh khoản · Vùng mờ = đã mitigated. Session/Kill Zone chỉ hiện ở khung ≤ 1h.
        Cyclical Extreme (Fisher Transform) là dải oscillator ở đáy chart — chấm xanh/đỏ đánh dấu điểm Fisher cắt tín hiệu ngay từ vùng cực trị (công thức Ehlers công khai, không phải hộp đen).
      </p>
    </AppShell>
  );
}
