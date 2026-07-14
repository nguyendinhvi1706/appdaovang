'use client';
import { useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { api } from '@/lib/api';

// ================= Thông số hợp đồng =================
const SYMBOLS = ['XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURJPY', 'GBPJPY'];

function specs(symbol: string) {
  if (symbol === 'XAUUSD') return { contract: 100, pipSize: 0.1 };     // 1 lot = 100 oz, 1 pip = 0.1$
  if (symbol === 'XAGUSD') return { contract: 5000, pipSize: 0.01 };
  if (symbol.endsWith('JPY')) return { contract: 100_000, pipSize: 0.01 };
  return { contract: 100_000, pipSize: 0.0001 };
}

/** Giá trị 1 pip cho 1 lot, quy về USD. JPY cần tỷ giá USDJPY. */
function pipValuePerLot(symbol: string, usdJpy: number | null): number | null {
  const { contract, pipSize } = specs(symbol);
  if (symbol.endsWith('JPY')) return usdJpy ? +(contract * pipSize / usdJpy).toFixed(2) : null;
  return +(contract * pipSize).toFixed(2); // các cặp quote USD & kim loại: $10/pip/lot
}

const fmt = (n: number | null | undefined, digits = 2) =>
  n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits });

function Field({ label, value, onChange, step = 'any' }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <label className="text-sm text-gray-400">
      {label}
      <input className="input mt-1" type="number" step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function SymbolSelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <label className="text-sm text-gray-400">
      Symbol
      <select className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {SYMBOLS.map((s) => <option key={s}>{s}</option>)}
      </select>
    </label>
  );
}

function Result({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <div className="mt-3 pt-3 border-t border-border space-y-1 text-sm">
      {rows.map(([k, v, highlight]) => (
        <div key={k} className="flex justify-between">
          <span className="text-gray-400">{k}</span>
          <span className={highlight ? 'text-accent font-bold text-base' : 'font-semibold'}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ================= Các công cụ =================

function LotSizeCalc({ usdJpy }: { usdJpy: number | null }) {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [balance, setBalance] = useState(1000);
  const [risk, setRisk] = useState(2);
  const [slPips, setSlPips] = useState(30);
  const pv = pipValuePerLot(symbol, usdJpy);
  const riskAmt = balance * risk / 100;
  const lot = pv && slPips > 0 ? riskAmt / (slPips * pv) : null;
  return (
    <div className="card">
      <h2 className="font-bold mb-3">📐 Lot Size theo Risk %</h2>
      <div className="grid grid-cols-2 gap-3">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        <Field label="Số dư ($)" value={balance} onChange={setBalance} />
        <Field label="Risk (%)" value={risk} onChange={setRisk} />
        <Field label="SL (pips)" value={slPips} onChange={setSlPips} />
      </div>
      <Result rows={[
        ['Tiền rủi ro', `$${fmt(riskAmt)}`],
        ['Pip value / lot', pv ? `$${fmt(pv)}` : 'cần tỷ giá'],
        ['Lot size', lot ? fmt(Math.floor(lot * 100) / 100) : '—', true],
      ]} />
    </div>
  );
}

function RRCalc({ usdJpy }: { usdJpy: number | null }) {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [entry, setEntry] = useState(4000);
  const [sl, setSl] = useState(3990);
  const [tp, setTp] = useState(4020);
  const [lot, setLot] = useState(0.1);
  const { pipSize } = specs(symbol);
  const pv = pipValuePerLot(symbol, usdJpy);
  const slPips = Math.abs(entry - sl) / pipSize;
  const tpPips = Math.abs(tp - entry) / pipSize;
  const rr = slPips > 0 ? tpPips / slPips : null;
  return (
    <div className="card">
      <h2 className="font-bold mb-3">⚖️ Risk : Reward</h2>
      <div className="grid grid-cols-2 gap-3">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        <Field label="Giá vào" value={entry} onChange={setEntry} />
        <Field label="Stop Loss" value={sl} onChange={setSl} />
        <Field label="Take Profit" value={tp} onChange={setTp} />
        <Field label="Lot" value={lot} onChange={setLot} step="0.01" />
      </div>
      <Result rows={[
        ['SL', `${fmt(slPips, 1)} pips${pv ? ` = -$${fmt(slPips * pv * lot)}` : ''}`],
        ['TP', `${fmt(tpPips, 1)} pips${pv ? ` = +$${fmt(tpPips * pv * lot)}` : ''}`],
        ['RR', rr ? `1 : ${fmt(rr, 2)}` : '—', true],
      ]} />
    </div>
  );
}

function PipMarginCalc({ usdJpy }: { usdJpy: number | null }) {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [lot, setLot] = useState(0.1);
  const [price, setPrice] = useState(4000);
  const [leverage, setLeverage] = useState(500);
  const { contract } = specs(symbol);
  const pv = pipValuePerLot(symbol, usdJpy);
  // Margin (USD): base là USD → contract/lev; ngược lại contract × giá base-USD / lev
  const baseIsUsd = symbol.startsWith('USD');
  const margin = leverage > 0 ? (baseIsUsd ? lot * contract / leverage : lot * contract * price / leverage) : null;
  return (
    <div className="card">
      <h2 className="font-bold mb-3">💰 Pip Value & Margin</h2>
      <div className="grid grid-cols-2 gap-3">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        <Field label="Lot" value={lot} onChange={setLot} step="0.01" />
        <Field label={baseIsUsd ? 'Giá (không dùng)' : 'Giá hiện tại'} value={price} onChange={setPrice} />
        <label className="text-sm text-gray-400">Đòn bẩy
          <select className="input mt-1" value={leverage} onChange={(e) => setLeverage(+e.target.value)}>
            {[50, 100, 200, 500, 1000, 2000].map((l) => <option key={l} value={l}>1:{l}</option>)}
          </select>
        </label>
      </div>
      <Result rows={[
        ['Pip value', pv ? `$${fmt(pv * lot)} (${fmt(pv)}/lot)` : 'cần tỷ giá USDJPY'],
        ['Contract size', `${fmt(lot * contract, 0)} ${symbol === 'XAUUSD' ? 'oz' : symbol === 'XAGUSD' ? 'oz bạc' : 'đơn vị'}`],
        ['Margin cần', margin ? `$${fmt(margin)}` : '—', true],
      ]} />
    </div>
  );
}

function ProfitCalc({ usdJpy }: { usdJpy: number | null }) {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
  const [entry, setEntry] = useState(4000);
  const [exit, setExit] = useState(4015);
  const [lot, setLot] = useState(0.1);
  const { pipSize } = specs(symbol);
  const pv = pipValuePerLot(symbol, usdJpy);
  const pips = (direction === 'BUY' ? exit - entry : entry - exit) / pipSize;
  const profit = pv ? pips * pv * lot : null;
  return (
    <div className="card">
      <h2 className="font-bold mb-3">📈 Lợi nhuận</h2>
      <div className="grid grid-cols-2 gap-3">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        <label className="text-sm text-gray-400">Chiều
          <select className="input mt-1" value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option>BUY</option><option>SELL</option>
          </select>
        </label>
        <Field label="Giá vào" value={entry} onChange={setEntry} />
        <Field label="Giá thoát" value={exit} onChange={setExit} />
        <Field label="Lot" value={lot} onChange={setLot} step="0.01" />
      </div>
      <Result rows={[
        ['Pips', fmt(pips, 1)],
        ['Lợi nhuận', profit != null ? `${profit >= 0 ? '+' : ''}$${fmt(profit)}` : '—', true],
      ]} />
    </div>
  );
}

function DrawdownCalc() {
  const [balance, setBalance] = useState(1000);
  const [risk, setRisk] = useState(2);
  const [losses, setLosses] = useState(5);
  const remaining = balance * Math.pow(1 - risk / 100, losses);
  const ddPct = (1 - remaining / balance) * 100;
  const recoverPct = remaining > 0 ? (balance / remaining - 1) * 100 : null;
  return (
    <div className="card">
      <h2 className="font-bold mb-3">📉 Drawdown & Phục hồi</h2>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Số dư ($)" value={balance} onChange={setBalance} />
        <Field label="Risk %/lệnh" value={risk} onChange={setRisk} />
        <Field label="Số lệnh thua liên tiếp" value={losses} onChange={setLosses} step="1" />
      </div>
      <Result rows={[
        ['Còn lại', `$${fmt(remaining)}`],
        ['Drawdown', `${fmt(ddPct, 1)}%`, true],
        ['Cần lãi để hồi vốn', recoverPct != null ? `+${fmt(recoverPct, 1)}%` : '—'],
      ]} />
      <p className="text-xs text-gray-500 mt-2">
        Mất 50% vốn cần lãi +100% mới hòa — đây là lý do risk mỗi lệnh nên ≤ 1-2%.
      </p>
    </div>
  );
}

// ================= Trang =================
export default function RiskPage() {
  const [usdJpy, setUsdJpy] = useState<number | null>(null);
  const [gold, setGold] = useState<number | null>(null);

  useEffect(() => {
    api<{ price: number }>('/market/quote/USDJPY').then((q) => setUsdJpy(q.price)).catch(() => {});
    api<{ price: number }>('/market/gold').then((q) => setGold(q.price)).catch(() => {});
  }, []);

  const note = useMemo(() => {
    const parts = [];
    if (gold) parts.push(`XAUUSD: ${fmt(gold)}`);
    if (usdJpy) parts.push(`USDJPY: ${fmt(usdJpy, 3)}`);
    return parts.join(' · ');
  }, [gold, usdJpy]);

  return (
    <AppShell>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-2xl font-bold">🛡️ Risk Manager</h1>
        {note && <span className="text-sm text-gray-400">Giá realtime — {note}</span>}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <LotSizeCalc usdJpy={usdJpy} />
        <RRCalc usdJpy={usdJpy} />
        <PipMarginCalc usdJpy={usdJpy} />
        <ProfitCalc usdJpy={usdJpy} />
        <DrawdownCalc />
      </div>
    </AppShell>
  );
}
