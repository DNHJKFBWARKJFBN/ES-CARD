"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Upload, Home, PieChart, ArrowUpRight, ArrowDownRight, Pencil, Check, ChevronLeft, ChevronRight, AlertTriangle, TrendingDown, TrendingUp, X } from "lucide-react";
import { Transaction, CATEGORIES } from "@/lib/parsers";

/* ── 색상 ── */
const CAT_COLOR: Record<string, string> = {
  "식비": "#f97316", "카페/음료": "#a78bfa", "쇼핑": "#ec4899", "교통": "#3b82f6",
  "통신": "#06b6d4", "의료/건강": "#10b981", "문화/여가": "#8b5cf6", "여행": "#f59e0b",
  "교육": "#6366f1", "뷰티/미용": "#f43f5e", "마트/편의점": "#84cc16", "월세/관리비": "#64748b",
  "공과금": "#0ea5e9", "보험": "#78716c", "구독": "#d946ef", "이체": "#94a3b8", "기타": "#9ca3af",
};
const SRC_LABEL: Record<string, string> = { kakao: "카카오뱅크", shinhan: "신한카드", unknown: "기타" };
const SRC_COLOR: Record<string, string> = { kakao: "bg-yellow-400", shinhan: "bg-blue-500", unknown: "bg-gray-400" };
const BUDGET_KEY = "es_card_budget";
const BUDGET_CREDIT_KEY = "es_card_budget_credit";
const BUDGET_DEBIT_KEY = "es_card_budget_debit";
const BUDGET_SAVINGS_KEY = "es_card_budget_savings";
const TXN_KEY = "es_card_transactions";

/* ── 도넛 차트 ── */
function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="w-32 h-32 rounded-full bg-gray-100 mx-auto" />;
  let cumPct = 0;
  const R = 54, CX = 64, CY = 64;
  const segments = data.map((d) => {
    const pct = d.value / total;
    const start = cumPct * 360;
    const end = (cumPct + pct) * 360;
    cumPct += pct;
    const toRad = (deg: number) => (deg - 90) * (Math.PI / 180);
    const x1 = CX + R * Math.cos(toRad(start)), y1 = CY + R * Math.sin(toRad(start));
    const x2 = CX + R * Math.cos(toRad(end)), y2 = CY + R * Math.sin(toRad(end));
    const large = pct > 0.5 ? 1 : 0;
    return { ...d, path: `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`, pct };
  });
  return (
    <svg viewBox="0 0 128 128" className="w-32 h-32">
      {segments.map((s, i) => <path key={i} d={s.path} fill={s.color} />)}
      <circle cx={CX} cy={CY} r={36} fill="white" />
    </svg>
  );
}

/* ── 스파크라인 ── */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 200, h = 60, pad = 4;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const fill = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const fillPath = `M ${fill[0]} L ${fill.join(" L ")} L ${pad + (w - pad * 2)},${h - pad} L ${pad},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14">
      <path d={fillPath} fill="rgba(34,197,94,0.15)" />
      <polyline points={pts} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Tab = "home" | "expenses" | "income" | "analytics" | "upload";

export default function App() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [tab, setTab] = useState<Tab>("home");
  const [budget, setBudget] = useState<number | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetCredit, setBudgetCredit] = useState<number | null>(null);
  const [budgetDebit, setBudgetDebit] = useState<number | null>(null);
  const [budgetSavings, setBudgetSavings] = useState<number | null>(null);
  const [editingSubBudget, setEditingSubBudget] = useState<string | null>(null);
  const [subBudgetInput, setSubBudgetInput] = useState("");
  const [selectedSource, setSelectedSource] = useState("kakao");
  const [filePassword, setFilePassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0); // 0 = 이번달, -1 = 저번달
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const b = localStorage.getItem(BUDGET_KEY);
    if (b) setBudget(parseFloat(b));
    const bc = localStorage.getItem(BUDGET_CREDIT_KEY);
    if (bc) setBudgetCredit(parseFloat(bc));
    const bd = localStorage.getItem(BUDGET_DEBIT_KEY);
    if (bd) setBudgetDebit(parseFloat(bd));
    const bs = localStorage.getItem(BUDGET_SAVINGS_KEY);
    if (bs) setBudgetSavings(parseFloat(bs));
    const t = localStorage.getItem(TXN_KEY);
    if (t) setTxns(JSON.parse(t));
  }, []);

  useEffect(() => {
    if (txns.length > 0) localStorage.setItem(TXN_KEY, JSON.stringify(txns));
  }, [txns]);

  /* ── 날짜 헬퍼 ── */
  const targetDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const monthLabel = `${targetDate.getFullYear()}년 ${targetDate.getMonth() + 1}월`;

  const inMonth = useCallback((dateStr: string, offset: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + offset);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    return dateStr.startsWith(`${y}-${String(m).padStart(2, "0")}`);
  }, []);

  const curTxns = useMemo(() => txns.filter((t) => inMonth(t.date, monthOffset)), [txns, monthOffset, inMonth]);
  const prevTxns = useMemo(() => txns.filter((t) => inMonth(t.date, monthOffset - 1)), [txns, monthOffset, inMonth]);

  const curExpenses = useMemo(() => curTxns.filter((t) => t.type === "expense"), [curTxns]);
  const curIncome = useMemo(() => curTxns.filter((t) => t.type === "income"), [curTxns]);
  const totalExpense = useMemo(() => curExpenses.reduce((s, t) => s + t.amount, 0), [curExpenses]);
  const totalIncome = useMemo(() => curIncome.reduce((s, t) => s + t.amount, 0), [curIncome]);
  const prevTotalExpense = useMemo(() => prevTxns.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0), [prevTxns]);

  const momDiff = prevTotalExpense > 0 ? ((totalExpense - prevTotalExpense) / prevTotalExpense) * 100 : null;

  /* 일별 지출 (스파크라인) */
  const dailySpend = useMemo(() => {
    const y = targetDate.getFullYear(), m = targetDate.getMonth();
    const days = new Date(y, m + 1, 0).getDate();
    const map: Record<number, number> = {};
    curExpenses.forEach((t) => { const d = parseInt(t.date.slice(8, 10)); map[d] = (map[d] || 0) + t.amount; });
    return Array.from({ length: days }, (_, i) => map[i + 1] || 0);
  }, [curExpenses, targetDate]);

  /* 카테고리별 합계 */
  const catTotals = useMemo(() =>
    CATEGORIES.map((cat) => ({
      cat, color: CAT_COLOR[cat],
      total: curExpenses.filter((t) => t.category === cat).reduce((s, t) => s + t.amount, 0),
    })).filter((c) => c.total > 0).sort((a, b) => b.total - a.total),
    [curExpenses]);

  /* 제일 많이 지출한 곳 */
  const topSpend = useMemo(() => {
    const map: Record<string, number> = {};
    curExpenses.forEach((t) => { map[t.description] = (map[t.description] || 0) + t.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [curExpenses]);

  /* 제일 많이 입금된 곳 */
  const topIncome = useMemo(() => {
    const map: Record<string, number> = {};
    curIncome.forEach((t) => { map[t.description] = (map[t.description] || 0) + t.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [curIncome]);

  /* 지출 줄여야 할 곳 */
  const warnings = useMemo(() => {
    const prevCatMap: Record<string, number> = {};
    prevTxns.filter((t) => t.type === "expense").forEach((t) => {
      prevCatMap[t.category ?? "기타"] = (prevCatMap[t.category ?? "기타"] || 0) + t.amount;
    });
    return catTotals
      .filter((c) => {
        const prev = prevCatMap[c.cat] || 0;
        return prev === 0 ? c.total > 50000 : (c.total - prev) / prev > 0.2;
      })
      .slice(0, 3);
  }, [catTotals, prevTxns]);

  /* 업로드 */
  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("source", selectedSource);
    if (filePassword) form.append("password", filePassword);
    try {
      const res = await fetch("/api/parse", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTxns((prev) => {
        const ids = new Set(prev.map((t) => t.id));
        return [...prev, ...(data.transactions as Transaction[]).filter((t) => !ids.has(t.id))];
      });
      setTab("home");
    } catch (e: unknown) { setUploadError((e as Error).message); }
    finally { setUploading(false); }
  }, [selectedSource, filePassword]);

  const saveBudget = () => {
    const v = parseFloat(budgetInput.replace(/,/g, ""));
    if (!isNaN(v) && v > 0) {
      setBudget(v);
      localStorage.setItem(BUDGET_KEY, String(v));
    }
    setEditingBudget(false);
  };

  const saveSubBudget = (key: string) => {
    const v = parseFloat(subBudgetInput.replace(/,/g, ""));
    if (!isNaN(v) && v > 0) {
      if (key === "credit") { setBudgetCredit(v); localStorage.setItem(BUDGET_CREDIT_KEY, String(v)); }
      if (key === "debit") { setBudgetDebit(v); localStorage.setItem(BUDGET_DEBIT_KEY, String(v)); }
      if (key === "savings") { setBudgetSavings(v); localStorage.setItem(BUDGET_SAVINGS_KEY, String(v)); }
    }
    setEditingSubBudget(null);
  };

  const fmt = (n: number) => `₩${n.toLocaleString()}`;

  /* ── 렌더 ── */
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto relative">
      {/* 상단 헤더 */}
      <div className="bg-white px-5 pt-12 pb-5 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <button onClick={() => setMonthOffset((o) => o - 1)} className="p-1 text-gray-400 hover:text-gray-700"><ChevronLeft size={18} /></button>
          <span className="text-sm font-semibold text-gray-700">{monthLabel}</span>
          <button onClick={() => setMonthOffset((o) => Math.min(o + 1, 0))} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" disabled={monthOffset === 0}><ChevronRight size={18} /></button>
        </div>
      </div>

      {/* 콘텐츠 영역 */}
      <div className="flex-1 overflow-y-auto pb-24 px-4 pt-4 space-y-4">

        {/* ── 홈 탭 ── */}
        {tab === "home" && (
          <>
            {/* 예산 카드 */}
            <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-3xl p-5 text-white shadow-lg">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs opacity-80">이번 달 예산</p>
                {!editingBudget && (
                  <button onClick={() => { setBudgetInput(budget ? String(budget) : ""); setEditingBudget(true); }} className="opacity-70 hover:opacity-100">
                    <Pencil size={13} />
                  </button>
                )}
              </div>
              {editingBudget ? (
                <div className="flex items-center gap-2">
                  <span className="text-lg">₩</span>
                  <input
                    autoFocus
                    type="number"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveBudget(); if (e.key === "Escape") setEditingBudget(false); }}
                    className="bg-white/20 rounded-lg px-2 py-1 text-xl font-bold w-40 outline-none placeholder-white/50"
                    placeholder="0"
                  />
                  <button onClick={saveBudget} className="bg-white/20 rounded-full p-1"><Check size={14} /></button>
                </div>
              ) : (
                <p className="text-3xl font-bold mb-3">{budget ? fmt(budget) : <span className="text-white/60 text-lg">예산 미설정</span>}</p>
              )}

              {budget && (
                <>
                  <div className="h-1.5 bg-white/30 rounded-full overflow-hidden mb-2">
                    <div className="h-full bg-white rounded-full transition-all" style={{ width: `${Math.min(100, (totalExpense / budget) * 100)}%` }} />
                  </div>
                  <div className="flex justify-between text-xs opacity-80">
                    <span>지출 {fmt(totalExpense)}</span>
                    <span>잔여 {fmt(Math.max(0, budget - totalExpense))}</span>
                  </div>
                </>
              )}
            </div>

            {/* 신용카드 / 체크카드 / 저금 예산 */}
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "credit", label: "신용카드 예산", value: budgetCredit, color: "text-purple-500", bg: "bg-purple-50", border: "border-purple-100" },
                { key: "debit", label: "체크카드 예산", value: budgetDebit, color: "text-blue-500", bg: "bg-blue-50", border: "border-blue-100" },
                { key: "savings", label: "저금 목표", value: budgetSavings, color: "text-emerald-500", bg: "bg-emerald-50", border: "border-emerald-100" },
              ] as { key: string; label: string; value: number | null; color: string; bg: string; border: string }[]).map(({ key, label, value, color, bg, border }) => (
                <div key={key} className={`bg-white rounded-2xl p-3 shadow-sm border ${border}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] text-gray-400 leading-tight">{label}</p>
                    {editingSubBudget !== key && (
                      <button onClick={() => { setSubBudgetInput(value ? String(value) : ""); setEditingSubBudget(key); }} className="text-gray-300 hover:text-gray-500 shrink-0">
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                  {editingSubBudget === key ? (
                    <div className="flex flex-col gap-1">
                      <input
                        autoFocus
                        type="number"
                        value={subBudgetInput}
                        onChange={(e) => setSubBudgetInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveSubBudget(key); if (e.key === "Escape") setEditingSubBudget(null); }}
                        className={`w-full ${bg} rounded-lg px-2 py-1 text-xs font-bold outline-none ${color}`}
                        placeholder="금액 입력"
                      />
                      <div className="flex gap-1">
                        <button onClick={() => saveSubBudget(key)} className={`flex-1 text-[10px] ${bg} ${color} rounded-lg py-0.5 font-medium`}>저장</button>
                        <button onClick={() => setEditingSubBudget(null)} className="flex-1 text-[10px] bg-gray-100 text-gray-400 rounded-lg py-0.5">취소</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setSubBudgetInput(value ? String(value) : ""); setEditingSubBudget(key); }} className="w-full text-left">
                      <p className={`text-sm font-bold ${value ? color : "text-gray-300"}`}>
                        {value ? `₩${value.toLocaleString()}` : "미설정"}
                      </p>
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* 지출/수입 카드 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-6 h-6 rounded-full bg-red-50 flex items-center justify-center">
                    <TrendingDown size={12} className="text-red-500" />
                  </div>
                  <p className="text-xs text-gray-400">지출</p>
                </div>
                <p className="text-xl font-bold text-gray-800">{fmt(totalExpense)}</p>
                {momDiff !== null && (
                  <p className={`text-[10px] mt-1 flex items-center gap-0.5 ${momDiff > 0 ? "text-red-400" : "text-green-500"}`}>
                    {momDiff > 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                    전월 대비 {Math.abs(momDiff).toFixed(1)}% {momDiff > 0 ? "증가" : "절약"}
                  </p>
                )}
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-6 h-6 rounded-full bg-green-50 flex items-center justify-center">
                    <TrendingUp size={12} className="text-green-500" />
                  </div>
                  <p className="text-xs text-gray-400">수입</p>
                </div>
                <p className="text-xl font-bold text-gray-800">{fmt(totalIncome)}</p>
                <p className="text-[10px] mt-1 text-gray-400">순수지 <span className={totalIncome - totalExpense >= 0 ? "text-green-500 font-semibold" : "text-red-400 font-semibold"}>{fmt(totalIncome - totalExpense)}</span></p>
              </div>
            </div>

            {/* 일별 지출 스파크라인 */}
            {dailySpend.some((v) => v > 0) && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-xs text-gray-400 mb-2">이번 달 일별 지출</p>
                <Sparkline data={dailySpend} />
              </div>
            )}

            {/* 전월 대비 */}
            {momDiff !== null && (
              <div className={`rounded-2xl p-4 shadow-sm flex items-center gap-3 ${momDiff <= 0 ? "bg-green-50" : "bg-red-50"}`}>
                {momDiff <= 0
                  ? <TrendingDown size={20} className="text-green-500 shrink-0" />
                  : <TrendingUp size={20} className="text-red-400 shrink-0" />}
                <div>
                  <p className="text-sm font-semibold text-gray-700">전월 대비</p>
                  <p className={`text-xs ${momDiff <= 0 ? "text-green-600" : "text-red-500"}`}>
                    {momDiff <= 0
                      ? `${Math.abs(momDiff).toFixed(1)}% 절약했어요 🎉`
                      : `${momDiff.toFixed(1)}% 더 지출했어요`}
                    {" "}(전월 {fmt(prevTotalExpense)})
                  </p>
                </div>
              </div>
            )}

            {/* 지출 줄여야 할 곳 */}
            {warnings.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={14} className="text-amber-500" />
                  <p className="text-xs font-semibold text-gray-700">지출 줄여야 할 곳</p>
                </div>
                <div className="space-y-2">
                  {warnings.map(({ cat, total, color }) => {
                    const prev = prevTxns.filter((t) => t.type === "expense" && t.category === cat).reduce((s, t) => s + t.amount, 0);
                    const pct = prev > 0 ? ((total - prev) / prev) * 100 : null;
                    return (
                      <div key={cat} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-xs text-gray-700">{cat}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-gray-800">{fmt(total)}</p>
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
                <p className="text-gray-300 text-4xl mb-3">📂</p>
                <p className="text-sm text-gray-400">파일 탭에서 거래내역을 업로드해주세요</p>
                <button onClick={() => setTab("upload")} className="mt-3 text-xs text-green-500 border border-green-200 rounded-full px-4 py-1.5 hover:bg-green-50">파일 업로드하기</button>
              </div>
            )}
          </>
        )}

        {/* ── 지출 탭 ── */}
        {tab === "expenses" && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-400 mb-1">이번 달 총 지출</p>
              <p className="text-2xl font-bold text-red-500">{fmt(totalExpense)}</p>
            </div>

            {/* 제일 많이 지출한 곳 */}
            {topSpend.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500 mb-3">제일 많이 지출한 곳</p>
                <div className="space-y-2">
                  {topSpend.map(([desc, amt], i) => (
                    <div key={desc} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-red-50 text-red-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="text-xs text-gray-700 truncate max-w-[160px]">{desc}</span>
                      </div>
                      <span className="text-xs font-semibold text-red-500">{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 세부 지출 내역 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-3">세부 지출 내역</p>
              <div className="space-y-2.5">
                {curExpenses.sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                  <div key={t.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button
                        onClick={() => setEditingCat(editingCat === t.id ? null : t.id)}
                        className="px-2 py-0.5 rounded-full text-[10px] text-white font-medium shrink-0"
                        style={{ background: CAT_COLOR[t.category ?? "기타"] }}
                      >
                        {t.category ?? "기타"}
                      </button>
                      <div className="min-w-0">
                        <p className="text-xs text-gray-700 truncate">{t.description}</p>
                        <p className="text-[10px] text-gray-400">{t.date}</p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-red-500 ml-2 shrink-0">-{fmt(t.amount)}</span>
                  </div>
                ))}
                {curExpenses.length === 0 && <p className="text-xs text-gray-400 text-center py-4">지출 내역이 없습니다.</p>}
              </div>
            </div>
          </>
        )}

        {/* ── 수입 탭 ── */}
        {tab === "income" && (
          <>
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs text-gray-400 mb-1">이번 달 총 수입</p>
              <p className="text-2xl font-bold text-green-500">{fmt(totalIncome)}</p>
            </div>

            {topIncome.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500 mb-3">제일 많이 입금된 곳</p>
                <div className="space-y-2">
                  {topIncome.map(([desc, amt], i) => (
                    <div key={desc} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-green-50 text-green-500 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="text-xs text-gray-700 truncate max-w-[160px]">{desc}</span>
                      </div>
                      <span className="text-xs font-semibold text-green-500">{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-3">세부 수입 내역</p>
              <div className="space-y-2.5">
                {curIncome.sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                  <div key={t.id} className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700 truncate">{t.description}</p>
                      <p className="text-[10px] text-gray-400">{t.date} · <span className={`text-[10px] text-white px-1.5 rounded-full ${SRC_COLOR[t.source]}`}>{SRC_LABEL[t.source]}</span></p>
                    </div>
                    <span className="text-xs font-semibold text-green-500 ml-2 shrink-0">+{fmt(t.amount)}</span>
                  </div>
                ))}
                {curIncome.length === 0 && <p className="text-xs text-gray-400 text-center py-4">수입 내역이 없습니다.</p>}
              </div>
            </div>
          </>
        )}

        {/* ── 분석 탭 ── */}
        {tab === "analytics" && (
          <>
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-4">카테고리별 지출</p>
              <div className="flex items-center gap-4">
                <DonutChart data={catTotals.slice(0, 6).map((c) => ({ label: c.cat, value: c.total, color: c.color }))} />
                <div className="flex-1 space-y-1.5">
                  {catTotals.slice(0, 6).map(({ cat, total, color }) => (
                    <div key={cat} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="text-[11px] text-gray-600">{cat}</span>
                      </div>
                      <span className="text-[11px] font-semibold text-gray-700">{totalExpense > 0 ? ((total / totalExpense) * 100).toFixed(0) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <p className="text-xs font-semibold text-gray-500 mb-3">전체 카테고리 분석</p>
              <div className="space-y-2.5">
                {catTotals.map(({ cat, total, color }) => {
                  const pct = totalExpense > 0 ? (total / totalExpense) * 100 : 0;
                  return (
                    <div key={cat}>
                      <div className="flex justify-between text-xs mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-gray-600">{cat}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400">{pct.toFixed(0)}%</span>
                          <span className="font-semibold text-gray-800">{fmt(total)}</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
                {catTotals.length === 0 && <p className="text-xs text-gray-400 text-center py-4">데이터가 없습니다.</p>}
              </div>
            </div>
          </>
        )}

        {/* ── 업로드 탭 ── */}
        {tab === "upload" && (
          <>
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <p className="text-sm font-semibold text-gray-700 mb-4">파일 업로드</p>
              <div className="flex gap-2 mb-4">
                {[{ key: "kakao", label: "카카오뱅크", sub: "CSV" }, { key: "shinhan", label: "신한카드", sub: "엑셀/CSV" }].map(({ key, label, sub }) => (
                  <button key={key} onClick={() => setSelectedSource(key)}
                    className={`flex-1 py-3 rounded-xl text-xs font-medium border transition-all ${selectedSource === key ? "bg-green-500 text-white border-green-500" : "text-gray-500 border-gray-200"}`}>
                    <p>{label}</p><p className="opacity-60 text-[10px]">{sub}</p>
                  </button>
                ))}
              </div>
              {/* 비밀번호 입력 (엑셀 암호 해제) */}
              <div className="mb-3">
                <label className="text-xs text-gray-400 block mb-1">
                  파일 비밀번호 <span className="text-gray-300">(엑셀에 암호가 걸린 경우)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={filePassword}
                    onChange={(e) => setFilePassword(e.target.value)}
                    placeholder={selectedSource === "kakao" ? "주민번호 앞 6자리" : "비밀번호 입력"}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-green-300"
                  />
                  {filePassword && (
                    <button onClick={() => setFilePassword("")} className="text-xs text-gray-400 hover:text-gray-600 px-2">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-gray-300 mt-1">입력한 비밀번호는 저장되지 않습니다</p>
              </div>

              <div
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-2xl p-10 text-center cursor-pointer hover:border-green-300 hover:bg-green-50/30 transition-all"
              >
                <Upload size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-400">{uploading ? "파싱 중..." : "파일 드래그 또는 클릭"}</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
              {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
            </div>

            {txns.length > 0 && (
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-500">로드된 데이터 ({txns.length}건)</p>
                  <button onClick={() => { setTxns([]); localStorage.removeItem(TXN_KEY); }}
                    className="text-[10px] text-red-400 border border-red-200 rounded-full px-2 py-0.5 flex items-center gap-1 hover:bg-red-50">
                    <X size={10} /> 전체 삭제
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-yellow-50 rounded-xl p-3">
                    <p className="text-gray-400">카카오뱅크</p>
                    <p className="font-bold text-gray-700">{txns.filter((t) => t.source === "kakao").length}건</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-3">
                    <p className="text-gray-400">신한카드</p>
                    <p className="font-bold text-gray-700">{txns.filter((t) => t.source === "shinhan").length}건</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 하단 네비게이션 */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-100 flex items-center px-4 pb-6 pt-3 z-50">
        {([
          { key: "home", icon: <Home size={20} />, label: "홈" },
          { key: "expenses", icon: <TrendingDown size={20} />, label: "지출" },
          { key: "income", icon: <TrendingUp size={20} />, label: "수입" },
          { key: "analytics", icon: <PieChart size={20} />, label: "분석" },
          { key: "upload", icon: <Upload size={20} />, label: "파일" },
        ] as { key: Tab; icon: React.ReactNode; label: string }[]).map(({ key, icon, label }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex-1 flex flex-col items-center gap-0.5 transition-colors ${tab === key ? "text-green-500" : "text-gray-300"}`}>
            {icon}
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
