'use client';
import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, UTCTimestamp } from 'lightweight-charts';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

type Trade = {
  direction: 'BUY' | 'SELL'; entryTime: number; entryPrice: number;
  exitTime: number; exitPrice: number; r: number; pnl: number; reason: string;
};
type Result = {
  candles: { time: number; open: number; high: number; low: number; close: number }[];
  trades: Trade[];
  equity: { time: number; value: number }[];
  stats: {
    totalTrades: number; wins: number; losses: number; winRate: number;
    netProfit: number; finalBalance: number; profitFactor: number | null;
    expectancyR: number; expectancyUsd: number; maxDrawdownPct: number;
    maxLoseStreak: number; avgWinUsd: number; avgLossUsd: number;
    stdDevR?: number;
  };
  periodDays?: number;
  split?: { firstHalf: HalfStat; secondHalf: HalfStat };
};

/** Khoảng tin cậy 95% của kỳ vọng R — cho biết kết quả có phân biệt được với "vô dụng" hay không.
 *  Đây là thứ quan trọng hơn winrate: nếu khoảng này còn chứa số 0 thì cỡ mẫu chưa đủ để kết luận,
 *  dù lợi nhuận hiển thị có đẹp đến đâu (vài lệnh may mắn cũng cho profit factor rất cao).
 *  Dùng ĐỘ LỆCH CHUẨN THẬT từ backend — trước đây ước lượng bằng giả định "thắng = 2R" cho ra
 *  khoảng hẹp hơn thực tế, tức lạc quan sai. */
function confidence(n: number, expR: number, sdR: number) {
  if (n < 2 || !sdR) return null;
  const se = sdR / Math.sqrt(n);
  return { lo: expR - 1.96 * se, hi: expR + 1.96 * se, t: expR / se };
}

const defaults = {
  symbol: 'XAUUSD', interval: '1h', strategy: 'ema_cross',
  emaFast: 9, emaSlow: 21, rsiPeriod: 14, rsiLower: 30, rsiUpper: 70,
  atrPeriod: 14, slAtrMult: 1.5, rr: 2, riskPercent: 1, initialBalance: 1000,
  fisherPeriod: 10, fisherThreshold: 1.2,
  grid369Unit: 100, grid369Anchor: 0, maxBars: 20000,
};

const strategyLabels: Record<string, string> = {
  ema_cross: 'EMA Cross', rsi_reversion: 'RSI đảo chiều', smc_bos: 'SMC BOS',
  cyclical_extreme: 'Cyclical Extreme (Fisher)', grid_369: 'Lưới 369 (kiểm chứng)',
  live_smc: '⭐ Setup lệnh thật — SMC', live_sk: '⭐ Setup lệnh thật — SK System',
  live_ict: '⭐ ICT (quét thanh khoản + Killzone)',
};

type HalfStat = { trades: number; winRate: number; expectancyR: number; profitFactor: number | null };

export default function BacktestPage() {
  const [form, setForm] = useState({ ...defaults });
  const [shared, setShared] = useState(false);

  // Nhận config từ trang Cộng đồng
  useEffect(() => {
    const raw = localStorage.getItem('backtest-import');
    if (!raw) return;
    localStorage.removeItem('backtest-import');
    try {
      const cfg = JSON.parse(raw);
      setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(cfg).filter(([k]) => k in defaults)) }));
    } catch {}
  }, []);

  async function share() {
    if (!result) return;
    const title = `${strategyLabels[form.strategy] ?? form.strategy} ${form.symbol} ${form.interval}`;
    await api('/shared', {
      method: 'POST',
      body: JSON.stringify({
        type: 'BACKTEST',
        title,
        description: `Win rate ${result.stats.winRate}% · PF ${result.stats.profitFactor ?? '∞'} · ${result.stats.totalTrades} lệnh · Max DD ${result.stats.maxDrawdownPct}%`,
        content: JSON.stringify({ config: form, stats: result.stats }, null, 2),
      }),
    });
    setShared(true);
    setTimeout(() => setShared(false), 3000);
  }
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const priceRef = useRef<HTMLDivElement>(null);
  const equityRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function run() {
    setLoading(true); setError('');
    try {
      const res = await api<Result>('/backtest', { method: 'POST', body: JSON.stringify(form) });
      setResult(res);
    } catch (err: any) {
      setError(err.message); setResult(null);
    } finally {
      setLoading(false);
    }
  }

  // Vẽ chart khi có kết quả
  useEffect(() => {
    chartsRef.current.forEach((c) => c.remove());
    chartsRef.current = [];
    if (!result || !priceRef.current || !equityRef.current) return;

    const opts = {
      layout: { background: { type: ColorType.Solid, color: 'transparent' as const }, textColor: '#9ca3af' },
      grid: { vertLines: { color: 'rgba(48,54,61,0.5)' }, horzLines: { color: 'rgba(48,54,61,0.5)' } },
      timeScale: { timeVisible: true, borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' },
    };

    const priceChart = createChart(priceRef.current, { ...opts, height: 380 });
    const candleSeries = priceChart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    candleSeries.setData(result.candles.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
    })));
    const markers = result.trades.flatMap((t) => ([
      {
        time: t.entryTime as UTCTimestamp,
        position: t.direction === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: t.direction === 'BUY' ? '#22c55e' : '#ef4444',
        shape: t.direction === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: t.direction,
      },
      {
        time: t.exitTime as UTCTimestamp,
        position: 'inBar' as const,
        color: t.pnl > 0 ? '#22c55e' : '#ef4444',
        shape: 'circle' as const,
        text: `${t.pnl > 0 ? '+' : ''}${t.r}R`,
      },
    ])).sort((a, b) => (a.time as number) - (b.time as number));
    candleSeries.setMarkers(markers);
    priceChart.timeScale().fitContent();

    const eqChart = createChart(equityRef.current, { ...opts, height: 200 });
    const eqSeries = eqChart.addAreaSeries({
      lineColor: '#d4a017', topColor: 'rgba(212,160,23,0.3)', bottomColor: 'rgba(212,160,23,0.02)',
    });
    eqSeries.setData(result.equity.map((e) => ({ time: e.time as UTCTimestamp, value: e.value })));
    eqChart.timeScale().fitContent();

    chartsRef.current = [priceChart, eqChart];
    return () => { chartsRef.current.forEach((c) => c.remove()); chartsRef.current = []; };
  }, [result]);

  const s = result?.stats;
  const statCards = s ? [
    ['Lợi nhuận ròng', `${s.netProfit >= 0 ? '+' : ''}${s.netProfit}$`, s.netProfit >= 0],
    ['Win Rate', `${s.winRate}% (${s.wins}W/${s.losses}L)`, s.winRate >= 50],
    ['Profit Factor', s.profitFactor ?? '∞', (s.profitFactor ?? 99) >= 1],
    ['Expectancy', `${s.expectancyR}R (${s.expectancyUsd}$/lệnh)`, s.expectancyR >= 0],
    ['Max Drawdown', `${s.maxDrawdownPct}%`, s.maxDrawdownPct < 20],
    ['Chuỗi thua dài nhất', s.maxLoseStreak, s.maxLoseStreak <= 5],
  ] as const : [];

  return (
    <AppShell>
      <h1 className="text-2xl font-bold mb-4">Backtest</h1>

      <div className="card grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4 text-sm">
        <label>Symbol
          <select className="input mt-1" value={form.symbol} onChange={(e) => set('symbol', e.target.value)}>
            {['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTC-USD'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label>Khung
          <select className="input mt-1" value={form.interval} onChange={(e) => set('interval', e.target.value)}>
            {['5m', '15m', '30m', '1h', '4h', '1d'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label>Chiến lược
          <select className="input mt-1" value={form.strategy} onChange={(e) => set('strategy', e.target.value)}>
            <option value="ema_cross">EMA Cross</option>
            <option value="rsi_reversion">RSI đảo chiều</option>
            <option value="smc_bos">SMC BOS</option>
            <option value="cyclical_extreme">Cyclical Extreme (Fisher)</option>
            <option value="grid_369">Lưới 369 (kiểm chứng)</option>
            <option value="live_smc">⭐ Setup lệnh thật — SMC</option>
            <option value="live_sk">⭐ Setup lệnh thật — SK System</option>
            <option value="live_ict">⭐ ICT (quét thanh khoản + Killzone)</option>
          </select>
        </label>
        {form.strategy === 'live_ict' && (
          <p className="sm:col-span-3 text-xs text-slate-400 leading-relaxed">
            <b>ICT</b> — khác SMC ở chỗ không chờ giá chạm Order Block, mà chờ giá <b>quét thủng đáy/đỉnh cũ
            rồi bật ngược lại</b> (stop hunt). Kèm 2 bộ lọc riêng của ICT: chỉ vào lệnh trong{' '}
            <b>Killzone</b> (London 07–10h, New York 12–15h giờ UTC) và chỉ BUY ở nửa dưới / SELL ở nửa
            trên của dealing range (<b>Premium/Discount</b>). Entry tại mốc OTE 0.705.
            Vì lọc theo giờ nên số lệnh sẽ ít hơn hẳn — cần độ sâu dữ liệu lớn.
          </p>
        )}
        {(form.strategy === 'live_smc' || form.strategy === 'live_sk') && (
          <p className="sm:col-span-3 text-xs text-slate-400 leading-relaxed">
            Chạy đúng thuật toán mà mục <b>Setup lệnh</b> đang dùng thật: entry chờ retest{' '}
            {form.strategy === 'live_smc' ? 'rìa Order Block/FVG gần nhất' : 'mốc Fibonacci 0.618 của sóng 3 điểm'},
            SL tối thiểu 1.5×ATR, RR giới hạn 1:1.5–1:5, lệnh chờ quá ~1 ngày chưa khớp thì huỷ.
            Các ô ATR/SL/RR bên dưới KHÔNG áp dụng (thuật toán tự quyết định), chỉ <b>% rủi ro</b> và{' '}
            <b>vốn ban đầu</b> có tác dụng. Nên chạy khung <b>15m</b> để khớp với bản chạy thật.
          </p>
        )}
        {form.strategy === 'ema_cross' && (<>
          <label>EMA nhanh<input className="input mt-1" type="number" value={form.emaFast} onChange={(e) => set('emaFast', +e.target.value)} /></label>
          <label>EMA chậm<input className="input mt-1" type="number" value={form.emaSlow} onChange={(e) => set('emaSlow', +e.target.value)} /></label>
        </>)}
        {form.strategy === 'rsi_reversion' && (<>
          <label>RSI kỳ<input className="input mt-1" type="number" value={form.rsiPeriod} onChange={(e) => set('rsiPeriod', +e.target.value)} /></label>
          <label>Quá bán<input className="input mt-1" type="number" value={form.rsiLower} onChange={(e) => set('rsiLower', +e.target.value)} /></label>
          <label>Quá mua<input className="input mt-1" type="number" value={form.rsiUpper} onChange={(e) => set('rsiUpper', +e.target.value)} /></label>
        </>)}
        {form.strategy === 'cyclical_extreme' && (<>
          <label>Fisher kỳ<input className="input mt-1" type="number" value={form.fisherPeriod} onChange={(e) => set('fisherPeriod', +e.target.value)} /></label>
          <label>Ngưỡng cực trị<input className="input mt-1" type="number" step="0.1" value={form.fisherThreshold} onChange={(e) => set('fisherThreshold', +e.target.value)} /></label>
        </>)}
        {form.strategy === 'grid_369' && (<>
          <label title="Chu kỳ lặp lưới, theo đúng tài liệu gốc là 100 cho XAUUSD. Với cặp giá trị nhỏ (VD EURUSD ~1.05) cần đổi đơn vị phù hợp, VD 1.">
            Chu kỳ lưới<input className="input mt-1" type="number" step="1" value={form.grid369Unit} onChange={(e) => set('grid369Unit', +e.target.value)} />
          </label>
          <label title="Pha dịch lưới (mặc định 0 để khách quan, không chọn theo hindsight)">
            Pha lưới (anchor)<input className="input mt-1" type="number" step="1" value={form.grid369Anchor} onChange={(e) => set('grid369Anchor', +e.target.value)} />
          </label>
        </>)}
        <label>SL (×ATR)<input className="input mt-1" type="number" step="0.5" value={form.slAtrMult} onChange={(e) => set('slAtrMult', +e.target.value)} /></label>
        <label>RR (TP)<input className="input mt-1" type="number" step="0.5" value={form.rr} onChange={(e) => set('rr', +e.target.value)} /></label>
        <label>Risk %<input className="input mt-1" type="number" step="0.5" value={form.riskPercent} onChange={(e) => set('riskPercent', +e.target.value)} /></label>
        <label>Vốn ban đầu<input className="input mt-1" type="number" value={form.initialBalance} onChange={(e) => set('initialBalance', +e.target.value)} /></label>
        <label title="Số nến lịch sử nạp về. Càng nhiều → càng nhiều lệnh → kết luận càng đáng tin. Lần chạy đầu ở mức sâu có thể mất 10-30 giây.">
          Độ sâu dữ liệu
          <select className="input mt-1" value={form.maxBars} onChange={(e) => set('maxBars', +e.target.value)}>
            <option value={500}>500 nến (nhanh, KHÔNG đủ kết luận)</option>
            <option value={5000}>5.000 nến</option>
            <option value={20000}>20.000 nến (khuyên dùng, ~30 giây lần đầu)</option>
            <option value={50000}>50.000 nến (có thể quá lâu, dễ lỗi)</option>
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="btn w-full" onClick={run} disabled={loading}>{loading ? 'Đang chạy...' : '▶ Chạy backtest'}</button>
          {result && (
            <button className="px-3 py-2 rounded-lg border border-border hover:border-accent whitespace-nowrap" onClick={share}>
              {shared ? '✅ Đã chia sẻ' : '📤 Chia sẻ'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-red-400 mb-4">{error}</p>}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {statCards.map(([label, value, good]) => (
              <div key={label as string} className="card">
                <div className="text-xs text-gray-400">{label}</div>
                <div className={`text-lg font-bold mt-1 ${good ? 'text-green-400' : 'text-red-400'}`}>{value}</div>
              </div>
            ))}
          </div>
          {(() => {
            const ci = confidence(s!.totalTrades, s!.expectancyR, s!.stdDevR ?? 0);
            if (!ci) return null;
            const inconclusive = ci.lo < 0 && ci.hi > 0;
            return (
              <div className={`card mb-4 border ${inconclusive ? 'border-amber-500/40' : 'border-green-500/40'}`}>
                <div className="text-xs text-gray-400">Độ tin cậy thống kê — {s!.totalTrades} lệnh
                  {result.periodDays ? ` trên ${result.periodDays} ngày dữ liệu` : ''}</div>
                <div className="text-sm mt-1">
                  Khoảng tin cậy 95% của kỳ vọng:{' '}
                  <b className={inconclusive ? 'text-amber-400' : 'text-green-400'}>
                    [{ci.lo.toFixed(2)}R , {ci.hi.toFixed(2)}R]
                  </b>
                </div>
                <div className="text-xs text-gray-400 mt-1 leading-relaxed">
                  {inconclusive
                    ? '⚠️ Khoảng này CHỨA số 0 — cỡ mẫu chưa đủ để phân biệt chiến lược này với một chiến lược vô dụng. Lợi nhuận hiển thị (dù dương hay âm) có thể hoàn toàn do may rủi. Hãy tăng độ sâu dữ liệu để có nhiều lệnh hơn trước khi kết luận.'
                    : ci.lo > 0
                      ? '✅ Khoảng này nằm hoàn toàn trên 0 — kỳ vọng dương khó giải thích bằng may rủi. Vẫn cần kiểm chứng ngoài mẫu trước khi tin dùng thật.'
                      : '❌ Khoảng này nằm hoàn toàn dưới 0 — chiến lược lỗ một cách có hệ thống, không phải xui.'}
                </div>
              </div>
            );
          })()}
          {result.split && (result.split.firstHalf.trades > 1 || result.split.secondHalf.trades > 1) && (() => {
            const a = result.split.firstHalf, b = result.split.secondHalf;
            const bothPositive = a.expectancyR > 0 && b.expectancyR > 0;
            const flipped = a.expectancyR > 0 && b.expectancyR <= 0;
            return (
              <div className={`card mb-4 border ${bothPositive ? 'border-green-500/40' : flipped ? 'border-red-500/40' : 'border-slate-600'}`}>
                <div className="text-xs text-gray-400 mb-2">
                  Kiểm chứng ngoài mẫu — chia đôi dữ liệu theo thời gian
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-400">
                    <tr><th className="text-left font-normal">Giai đoạn</th><th>Lệnh</th><th>Win</th><th>PF</th><th>Kỳ vọng</th></tr>
                  </thead>
                  <tbody>
                    {([['Nửa đầu (dùng để tìm/chỉnh)', a], ['Nửa sau (kiểm chứng thật)', b]] as const).map(([label, h]) => (
                      <tr key={label} className="border-t border-slate-700/60">
                        <td className="py-1">{label}</td>
                        <td className="text-center">{h.trades}</td>
                        <td className="text-center">{h.winRate}%</td>
                        <td className="text-center">{h.profitFactor ?? '∞'}</td>
                        <td className={`text-center font-bold ${h.expectancyR > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {h.expectancyR > 0 ? '+' : ''}{h.expectancyR}R
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-xs text-gray-400 mt-2 leading-relaxed">
                  {flipped
                    ? '❌ Nửa đầu lãi nhưng nửa sau lỗ — dấu hiệu điển hình của việc khớp nhiễu quá khứ (overfitting). Đừng tin kết quả tổng.'
                    : bothPositive
                      ? '✅ Dương ở CẢ HAI nửa — đây là điều kiện tối thiểu để một lợi thế đáng được xem xét (chưa phải bằng chứng đủ).'
                      : 'Kết quả trái chiều hoặc âm — chưa có dấu hiệu của lợi thế bền vững.'}
                </div>
              </div>
            );
          })()}
          <div className="card p-0 overflow-hidden mb-4"><div ref={priceRef} /></div>
          <div className="text-sm text-gray-400 mb-1">Đường vốn (Equity)</div>
          <div className="card p-0 overflow-hidden mb-4"><div ref={equityRef} /></div>

          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-gray-400 text-left">
                  <th className="p-2">#</th><th className="p-2">Chiều</th><th className="p-2">Vào</th>
                  <th className="p-2">Giá vào</th><th className="p-2">Giá thoát</th>
                  <th className="p-2">R</th><th className="p-2">PnL</th><th className="p-2">Lý do</th>
                </tr>
              </thead>
              <tbody>
                {result!.trades.map((t, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="p-2 text-gray-500">{i + 1}</td>
                    <td className={`p-2 font-semibold ${t.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{t.direction}</td>
                    <td className="p-2 text-gray-400">{new Date(t.entryTime * 1000).toLocaleString('vi-VN')}</td>
                    <td className="p-2">{t.entryPrice}</td>
                    <td className="p-2">{t.exitPrice}</td>
                    <td className={`p-2 ${t.r >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.r >= 0 ? '+' : ''}{t.r}</td>
                    <td className={`p-2 ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{t.pnl >= 0 ? '+' : ''}{t.pnl}$</td>
                    <td className="p-2 text-gray-400">{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!s && !loading && !error && (
        <div className="card text-center text-gray-500 py-10">Cấu hình chiến lược rồi bấm "Chạy backtest".</div>
      )}
    </AppShell>
  );
}
