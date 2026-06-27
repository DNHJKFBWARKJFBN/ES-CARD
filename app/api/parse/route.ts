import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseKakaoCSV, parseKakaoExcelRows, parseShinhanData, guessCategory } from "@/lib/parsers";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const source = form.get("source") as string | null;
  const password = (form.get("password") as string | null) || undefined;

  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");

  try {
    let txns;

    if (source === "kakao" && !isExcel) {
      // 카카오뱅크 CSV (암호 없음)
      const text = buffer.toString("utf-8").replace(/^﻿/, "");
      txns = parseKakaoCSV(text);

    } else if (source === "kakao" && isExcel) {
      // 카카오뱅크 엑셀 — SheetJS로 암호 해제 후 파싱
      if (!password) {
        return NextResponse.json(
          { error: "카카오뱅크 엑셀 파일은 비밀번호가 필요합니다. (주민번호 앞 6자리)" },
          { status: 400 }
        );
      }
      // SheetJS 0.18+ 는 password 옵션으로 OOXML 암호화 지원
      const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, password });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // raw rows 추출
      const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(ws, {
        header: 1,
        defval: null,
        raw: false, // 날짜를 문자열로
      });
      txns = parseKakaoExcelRows(rows as (string | number | Date | null)[][]);

    } else {
      // 신한카드 등
      const readOpts: XLSX.ParsingOptions = { type: "buffer", cellDates: true };
      if (password) (readOpts as Record<string, unknown>).password = password;
      const wb = XLSX.read(buffer, readOpts);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
      txns = parseShinhanData(rows);
    }

    txns = txns.map((t) => ({ ...t, category: t.category ?? guessCategory(t.description) }));
    return NextResponse.json({ transactions: txns, count: txns.length });

  } catch (e: unknown) {
    const msg = (e as Error).message ?? "파싱 오류";
    if (msg.toLowerCase().includes("password") || msg.toLowerCase().includes("decrypt") || msg.toLowerCase().includes("암호")) {
      return NextResponse.json(
        { error: "비밀번호가 틀렸습니다. 주민번호 앞 6자리를 확인해주세요." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
