import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseKakaoCSV, parseShinhanData, guessCategory } from "@/lib/parsers";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const source = form.get("source") as string | null;

  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  try {
    let txns;

    if (source === "kakao" || name.endsWith(".csv")) {
      const text = buffer.toString("utf-8").replace(/^﻿/, ""); // BOM 제거
      txns = parseKakaoCSV(text);
    } else {
      // Excel 파싱 (신한카드 등)
      const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
      txns = parseShinhanData(rows);
    }

    // 카테고리 자동 분류
    txns = txns.map((t) => ({ ...t, category: t.category ?? guessCategory(t.description) }));

    return NextResponse.json({ transactions: txns, count: txns.length });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
