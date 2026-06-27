"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { ArrowUpRight, ArrowDownRight, Pencil, Check, ChevronLeft, ChevronRight, AlertTriangle, TrendingDown, Plus, X } from "lucide-react";

/* ── 카테고리 ── */
const CATEGORIES = [
  "식비", "카페/음료", "쇼핑", "교통", "통신", "의료/건강",
  "문화/여가", "여행", "교육", "뷰티/미용", "마트/편의점",
  "월세/관리비", "공과금", "보험", "구독", "기타",
];
const CAT_COLOR: Record<string, string> = {
  "식비": "#f97316", "카페/음료": "#a78bfa", "쇼핑": "#ec4899", "교통": "#3b82f6",
  "통신": "#06b6d4", "의료/건강": "#10b981", "문화/여가": "#8b5cf6", "여행": "#f59e0b",
  "교육": "#6366f1", "뷰티/미용": "#f43f5e", "마트/편의점": "#84cc16", "월세/관리비": "#64748b",
  "공과금": "#0ea5e9", "보험": "#78716c", "구독": "#d946ef", "기타": "#9ca3af",
};

const TARGET_KEY = "es_savings_target";
const TXN_KEY    = "es_savings_txns";

type EntryType = "savings" | "expense";
interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: EntryType;
  category?: string;
}

type Tab = "home" | "expense" | "savings" | "analytics";

/* ── 도넛 차트 ── */
function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="w-32 h-32 rounded-full bg-gray-100 mx-auto" />;
  let cum = 0;
  const R = 54, CX = 64, CY = 64;
  const segs = data.map((d) => {
    const pct = d.value / total;
    const s = cum * 360, e = (cum + pct) * 360;
    cum += pct;
    const r = (deg: number) => (deg - 90) * (Math.PI / 180);
    const x1 = CX + R * Math.cos(r(s)), y1 = CY + R * Math.sin(r(s));
    const x2 = CX + R * Math.cos(r(e)), y2 = CY + R * Math.sin(r(e));
    return { ...d, path: `M${CX} ${CY} L${x1} ${y1} A${R} ${R} 0 ${pct > 0.5 ? 1 : 0} 1 ${x2} ${y2}Z` };
  });
  return (
    <svg viewBox="0 0 128 128" className="w-32 h-32">
      {segs.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
      <circle cx={CX} cy={CY} r={36} fill="white" />
    </svg>
  );
}

/* ── 스파크라인 ── */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2 || !data.some(v => v > 0)) return null;
  const max = Math.max(...data, 1);
  const w = 200, h = 60, p = 4;
  const pts = data.map((v, i) => `${p + (i / (data.length - 1)) * (w - p * 2)},${h - p - (v / max) * (h - p * 2)}`).join(" ");
  const first = pts.split(" ")[0], last = pts.split(" ").at(-1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <path d={`M${first} L${pts} L${last?.split(",")[0]},${h - p} L${p},${h - p}Z`} fill="rgba(34,197,94,0.12)" />
      <polyline points={pts} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ── 수기 입력 모달 ── */
function AddModal({ type, onSave, onClose }: { type: EntryType; onSave: (t: Transaction) => void; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [date, setDate] = useState(today);
  const [cat, setCat] = useState("기타");

  const submit = () => {
    const amt = parseInt(amount.replace(/,/g, ""));
    if (!amt || !desc) return;
    onSave({ id: `${type}-${Date.now()}`, date, description: desc, amount: amt, type, category: type === "expense" ? cat : undefined });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end" onClick={onClose}>
      <div className="bg-white w-full max-w-md mx-auto rounded-t-3xl p-6 pb-10 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <p className="font-bold text-gray-800">{type === "savings" ? "💰 저금 추가" : "💸 지출 추가"}</p>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">금액</label>
          <div className="flex items-center border border-gray-200 rounded-xl px-3 py-2">
            <span className="text-gray-400 mr-1">₩</span>
            <input
              autoFocus type="number" placeholder="0"
              value={amount} onChange={e => setAmount(e.target.value)}
              className="flex-1 outline-none text-lg font-bold text-gray-800"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">메모</label>
          <input
            type="text" placeholder={type === "savings" ? "월급, 부수입 등" : "어디서 썼나요?"}
            value={desc} onChange={e => setDesc(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-green-300"
          />
        </div>

        <div>
          <label className="text-xs text-gray-400 mb-1 block">날짜</label>
          <input
            type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-green-300"
          />
        </div>

        {type === "expense" && (
          <div>
            <label className="text-xs text-gray-400 mb-1 block">카테고리</label>
            <select value={cat} onChange={e => setCat(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        )}

        <button
          onClick={submit}
          className={`w-full py-3 rounded-2xl text-white font-bold text-sm ${type === "savings" ? "bg-green-500" : "bg-red-400"}`}
        >
          저장
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [txns, setTxns]               = useState<Transaction[]>([]);
  const [target, setTarget]           = useState<number | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [tab, setTab]                 = useState<Tab>("home");
  const [monthOffset, setMonthOffset] = useState(0);
  const [addModal, setAddModal]       = useState<EntryType | null>(null);
  const [editingCat, setEditingCat]   = useState<string | null>(null);

  // 로드
  useEffect(() => {
    const t = localStorage.getItem(TARGET_KEY);
    if (t) setTarget(parseFloat(t));
    const d = localStorage.getItem(TXN_KEY);
    if (d) setTxns(JSON.parse(d));
  }, []);

  // 저장
  useEffect(() => {
    localStorage.setItem(TXN_KEY, JSON.stringify(txns));
  }, [txns]);

  const saveTarget = () => {
    const v = parseFloat(targetInput.replace(/,/g, ""));
    if (!isNaN(v) && v > 0) { setTarget(v); localStorage.setItem(TARGET_KEY, String(v)); }
    setEditingTarget(false);
  };

  const addTxn = useCallback((t: Transaction) => {
    setTxns(prev => [t, ...prev]);
  }, []);

  const deleteTxn = (id: string) => setTxns(prev => prev.filter(t => t.id !== id));

  // 날짜 헬퍼
  const targetDate = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() + monthOffset); return d;
  }, [monthOffset]);
  const monthLabel = `${targetDate.getFullYear()}년 ${targetDate.getMonth() + 1}월`;

  const inMonth = useCallback((date: string, offset: number) => {
    const d = new Date(); d.setMonth(d.getMonth() + offset);
    return date.startsWith(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }, []);

  const curTxns    = useMemo(() => txns.filter(t => inMonth(t.date, monthOffset)), [txns, monthOffset, inMonth]);
  const prevTxns   = useMemo(() => txns.filter(t => inMonth(t.date, monthOffset - 1)), [txns, monthOffset, inMonth]);

  const curSavings  = useMemo(() => curTxns.filter(t => t.type === "savings"), [curTxns]);
  const curExpenses = useMemo(() => curTxns.filter(t => t.type === "expense"), [curTxns]);

  const totalSavings = useMemo(() => curSavings.reduce((s, t) => s + t.amount, 0), [curSavings]);
  const totalExpense = useMemo(() => curExpenses.reduce((s, t) => s + t.amount, 0), [curExpenses]);

  // 누적 저금 (전체 기간)
  const allTimeSavings = useMemo(() => txns.filter(t => t.type === "savings").reduce((s, t) => s + t.amount, 0), [txns]);

  const prevTotalSavings = useMemo(() => prevTxns.filter(t => t.type === "savings").reduce((s, t) => s + t.amount, 0), [prevTxns]);
  const momDiff = prevTotalSavings > 0 ? ((totalSavings - prevTotalSavings) / prevTotalSavings) * 100 : null;

  // 카테고리 분석
  const catTotals = useMemo(() =>
    CATEGORIES.map(cat => ({
      cat, color: CAT_COLOR[cat],
      total: curExpenses.filter(t => t.category === cat).reduce((s, t) => s + t.amount, 0),
    })).filter(c => c.total > 0).sort((a, b) => b.total - a.total),
    [curExpenses]);

  // 지출 Top
  const topSpend = useMemo(() => {
    const map: Record<string, number> = {};
    curExpenses.forEach(t => { map[t.description] = (map[t.description] || 0) + t.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [curExpenses]);

  // 일별 저금 스파크라인
  const dailySavings = useMemo(() => {
    const days = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0).getDate();
    const map: Record<number, number> = {};
    curSavings.forEach(t => { const d = parseInt(t.date.slice(8, 10)); map[d] = (map[d] || 0) + t.amount; });
    return Array.from({ length: days }, (_, i) => map[i + 1] || 0);
  }, [curSavings, targetDate]);

  // 지출 줄여야 할 곳
  const warnings = useMemo(() => {
    const prevMap: Record<string, number> = {};
    prevTxns.filter(t => t.type === "expense").forEach(t => {
      prevMap[t.category ?? "기타"] = (prevMap[t.category ?? "기타"] || 0) + t.amount;
    });
    return catTotals.filter(c => {
      const prev = prevMap[c.cat] || 0;
      return prev === 0 ? c.total > 50000 : (c.total - prev) / prev > 0.2;
    }).slice(0, 3);
  }, [catTotals, prevTxns]);

  const fmt = (n: number) => `₩${n.toLocaleString()}`;
  const targetPct = target && allTimeSavings ? Math.min(100, (allTimeSavings / target) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* 헤더 */}
      <div className="bg-white px-5 pt-12 pb-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">🐷</span>
          <span className="text-base font-bold text-gray-800">ES 저금통</span>
        </div>
        <div className="flex items-center justify-between">
          <button onClick={() => setMonthOffset(o => o - 1)} className="p-1 text-gray-400"><ChevronLeft size={18} /></button>
          <span className="text-sm font-semibold text-gray-700">📅 {monthLabel}</span>
          <button onClick={() => setMonthOffset(o => Math.min(o + 1, 0))} disabled={monthOffset === 0} className="p-1 text-gray-400 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-y-auto pb-24 px-4 pt-4 space-y-4">

        {/* ── 홈 ── */}
        {tab === "home" && (
          <>
            {/* 목표 현금 + 저축 현황 카드 */}
            <div className="bg-gradient-to-br from-green-400 to-emerald-600 rounded-3xl p-6 text-white shadow-xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs opacity-70">🎯 목표 현금 액수</p>
                {!editingTarget && (
                  <button onClick={() => { setTargetInput(target ? String(target) : ""); setEditingTarget(true); }} className="opacity-70 hover:opacity-100">
                    <Pencil size={13} />
                  </button>
                )}
              </div>
              {editingTarget ? (
                <div className="flex items-center gap-2 mb-3">
                  <span>₩</span>
                  <input autoFocus type="number" value={targetInput}
                    onChange={e => setTargetInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") saveTarget(); if (e.key === "Escape") setEditingTarget(false); }}
                    className="bg-white/20 rounded-lg px-2 py-1 text-xl font-bold w-44 outline-none placeholder-white/50"
                    placeholder="목표 금액" />
                  <button onClick={saveTarget} className="bg-white/20 rounded-full p-1"><Check size={14} /></button>
                </div>
              ) : (
                <p className="text-3xl font-bold mb-1">{target ? fmt(target) : <span className="text-white/50 text-xl">목표 금액 설정</span>}</p>
              )}

              <div className="mt-3">
                <div className="flex justify-between text-xs opacity-80 mb-1">
                  <span>💰 현금 저축 현황</span>
                  <span>{target ? `${targetPct.toFixed(0)}%` : ""}</span>
                </div>
                <div className="h-2 bg-white/25 rounded-full overflow-hidden mb-2">
                  <div className="h-full bg-white rounded-full transition-all" style={{ width: `${targetPct}%` }} />
                </div>
                <div className="flex justify-between text-xs opacity-80">
                  <span className="font-bold text-base text-white">{fmt(allTimeSavings)}</span>
                  <span>{target ? `잔여 ${fmt(Math.max(0, target - allTimeSavings))}` : ""}</span>
                </div>
              </div>
            </div>

            {/* 이번 달 저금 / 사용 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-green-50">
                <p className="text-xs text-gray-400 mb-1">💰 이번 달 저금액</p>
                <p className="text-xl font-bold text-green-500">+{fmt(totalSavings)}</p>
                {momDiff !== null && (
                  <p className={`text-[10px] mt-1 flex items-center gap-0.5 ${momDiff >= 0 ? "text-green-500" : "text-red-400"}`}>
                    {momDiff >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    전월 대비 {Math.abs(momDiff).toFixed(0)}% {momDiff >= 0 ? "증가" : "감소"}
                  </p>
                )}
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-red-50">
                <p className="text-xs text-gray-400 mb-1">💸 이번 달 사용액</p>
                <p className="text-xl font-bold text-red-400">-{fmt(totalExpense)}</p>
                <p className="text-[10px] mt-1 text-gray-400">
                  순저금 <span className={`font-semibold ${totalSavings - totalExpense >= 0 ? "text-green-500" : "text-red-400"}`}>{fmt(totalSavings - totalExpense)}</span>
                </p>
              </div>
            </div>

            {/* 스파크라인 */}
            {dailySavings.some(v => v > 0) && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-xs text-gray-400 mb-1">📊 이번 달 일별 저금</p>
                <Sparkline data={dailySavings} />
              </div>
            )}

            {/* 전월 대비 */}
            {momDiff !== null && (
              <div className={`rounded-2xl p-4 flex items-center gap-3 ${momDiff >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                <span className="text-2xl">{momDiff >= 0 ? "🎉" : "😅"}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-700">전월 대비</p>
                  <p className={`text-xs ${momDiff >= 0 ? "text-green-600" : "text-red-500"}`}>
                    저금 {momDiff >= 0 ? `${momDiff.toFixed(0)}% 더 했어요!` : `${Math.abs(momDiff).toFixed(0)}% 줄었어요`}
                    {" "}(전월 {fmt(prevTotalSavings)})
                  </p>
                </div>
              </div>
            )}

            {/* 지출 줄여야 할 곳 */}
            {warnings.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={14} className="text-amber-500" />
                  <p className="text-xs font-semibold text-gray-700">⚠️ 지출 줄여야 할 곳</p>
                </div>
                <div className="space-y-2">
                  {warnings.map(({ cat, total, color }) => {
                    const prev = prevTxns.filter(t => t.type === "expense" && t.category === cat).reduce((s, t) => s + t.amount, 0);
                    const pct = prev > 0 ? ((total - prev) / prev) * 100 : null;
                    return (
                      <div key={cat} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-xs text-gray-700">{cat}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold">{fmt(total)}</p>
                          {pct !== null && <p className="text-[10px] text-red-400">+{pct.toFixed(0)}% ↑</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {txns.length === 0 && (
              <div className="text-center py-16">
                <p className="text-5xl mb-3">🐷</p>
                <p className="text-sm text-gray-400 mb-4">아직 기록이 없어요</p>
                <div className="flex gap-2 justify-center">
                  <button onClick={() => setAddModal("savings")} className="text-xs bg-green-500 text-white rounded-full px-4 py-2">💰 저금 추가</button>
                  <button onClick={() => setAddModal("expense")} className="text-xs bg-red-400 text-white rounded-full px-4 py-2">💸 지출 추가</button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── 지출 탭 ── */}
        {tab === "expense" && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-400 mb-1">💸 이번 달 총 지출</p>
              <p className="text-2xl font-bold text-red-400">{fmt(totalExpense)}</p>
            </div>

            {topSpend.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500 mb-3">🏆 제일 많이 쓴 곳</p>
                <div className="space-y-2">
                  {topSpend.map(([desc, amt], i) => (
                    <div key={desc} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-red-50 text-red-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="text-xs text-gray-700 truncate max-w-[160px]">{desc}</span>
                      </div>
                      <span className="text-xs font-semibold text-red-400">{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-3">🧾 세부 지출 내역</p>
              <div className="space-y-2.5">
                {curExpenses.sort((a, b) => b.date.localeCompare(a.date)).map(t => (
                  <div key={t.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {editingCat === t.id ? (
                        <select autoFocus defaultValue={t.category}
                          onChange={e => { setTxns(p => p.map(x => x.id === t.id ? { ...x, category: e.target.value } : x)); setEditingCat(null); }}
                          onBlur={() => setEditingCat(null)}
                          className="text-[10px] border border-indigo-300 rounded px-1 py-0.5 outline-none">
                          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      ) : (
                        <button onClick={() => setEditingCat(t.id)}
                          className="px-2 py-0.5 rounded-full text-[10px] text-white font-medium shrink-0"
                          style={{ background: CAT_COLOR[t.category ?? "기타"] }}>
                          {t.category ?? "기타"}
                        </button>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs text-gray-700 truncate">{t.description}</p>
                        <p className="text-[10px] text-gray-400">{t.date}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-red-400 shrink-0">-{fmt(t.amount)}</span>
                      <button onClick={() => deleteTxn(t.id)} className="text-gray-300 hover:text-red-400"><X size={12} /></button>
                    </div>
                  </div>
                ))}
                {curExpenses.length === 0 && <p className="text-xs text-gray-400 text-center py-4">지출 내역이 없습니다.</p>}
              </div>
            </div>
          </>
        )}

        {/* ── 저금 탭 ── */}
        {tab === "savings" && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-400 mb-1">💰 이번 달 저금액</p>
              <p className="text-2xl font-bold text-green-500">+{fmt(totalSavings)}</p>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-3">🧾 저금 내역</p>
              <div className="space-y-2.5">
                {curSavings.sort((a, b) => b.date.localeCompare(a.date)).map(t => (
                  <div key={t.id} className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700 truncate">{t.description}</p>
                      <p className="text-[10px] text-gray-400">{t.date}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-green-500 shrink-0">+{fmt(t.amount)}</span>
                      <button onClick={() => deleteTxn(t.id)} className="text-gray-300 hover:text-red-400"><X size={12} /></button>
                    </div>
                  </div>
                ))}
                {curSavings.length === 0 && <p className="text-xs text-gray-400 text-center py-4">저금 내역이 없습니다.</p>}
              </div>
            </div>
          </>
        )}

        {/* ── 분석 탭 ── */}
        {tab === "analytics" && (
          <>
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-4">🍩 카테고리별 지출</p>
              <div className="flex items-center gap-4">
                <DonutChart data={catTotals.slice(0, 6).map(c => ({ label: c.cat, value: c.total, color: c.color }))} />
                <div className="flex-1 space-y-1.5">
                  {catTotals.slice(0, 6).map(({ cat, total, color }) => (
                    <div key={cat} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-[11px] text-gray-600">{cat}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-gray-700">
                        {totalExpense > 0 ? ((total / totalExpense) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-3">📈 전체 카테고리 분석</p>
              <div className="space-y-2.5">
                {catTotals.map(({ cat, total, color }) => {
                  const pct = totalExpense > 0 ? (total / totalExpense) * 100 : 0;
                  return (
                    <div key={cat}>
                      <div className="flex justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-gray-600">{cat}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400">{pct.toFixed(0)}%</span>
                          <span className="font-semibold text-gray-800">{fmt(total)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
                {catTotals.length === 0 && <p className="text-xs text-gray-400 text-center py-4">지출 데이터가 없습니다.</p>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* + 버튼 (저금/지출 탭에서 표시) */}
      {(tab === "savings" || tab === "expense") && (
        <button
          onClick={() => setAddModal(tab === "savings" ? "savings" : "expense")}
          className={`fixed bottom-24 right-6 w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white z-40 ${tab === "savings" ? "bg-green-500" : "bg-red-400"}`}
        >
          <Plus size={22} />
        </button>
      )}

      {/* 홈 탭 + 버튼들 */}
      {tab === "home" && txns.length > 0 && (
        <div className="fixed bottom-24 right-4 flex flex-col gap-2 z-40">
          <button onClick={() => setAddModal("savings")} className="w-11 h-11 rounded-full bg-green-500 shadow-lg flex items-center justify-center text-white text-lg">💰</button>
          <button onClick={() => setAddModal("expense")} className="w-11 h-11 rounded-full bg-red-400 shadow-lg flex items-center justify-center text-white text-lg">💸</button>
        </div>
      )}

      {/* 하단 네비게이션 */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 flex items-center px-4 pb-6 pt-3 z-50">
        {([
          { key: "home",      emoji: "🏠", label: "홈" },
          { key: "expense",   emoji: "💸", label: "지출" },
          { key: "savings",   emoji: "💰", label: "저금" },
          { key: "analytics", emoji: "📊", label: "분석" },
        ] as { key: Tab; emoji: string; label: string }[]).map(({ key, emoji, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center gap-0.5 transition-all ${tab === key ? "scale-110" : "opacity-40"}`}>
            <span className="text-xl">{emoji}</span>
            <span className={`text-[10px] font-medium ${tab === key ? "text-green-500" : "text-gray-400"}`}>{label}</span>
          </button>
        ))}
      </div>

      {/* 입력 모달 */}
      {addModal && <AddModal type={addModal} onSave={addTxn} onClose={() => setAddModal(null)} />}
    </div>
  );
}
