import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { parseKakaoCSV, parseKakaoExcelRows, parseShinhanData, guessCategory } from "@/lib/parsers";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const source = form.get("source") as string | null;
  const password = (form.get("password") as string | null) || undefined;

  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const name = file.name.toLowerCase();
  const isExcel = name.endsWith(".xlsx") || name.endsWith(".xls");

  try {
    let txns;

    if (source === "kakao" && !isExcel) {
      // 카카오뱅크 CSV (암호 없음)
      const text = buffer.toString("utf-8").replace(/^﻿/, ""); // BOM 제거
      txns = parseKakaoCSV(text);

    } else if (source === "kakao" && isExcel) {
      // 카카오뱅크 엑셀 — exceljs로 암호 해제
      if (!password) {
        return NextResponse.json(
          { error: "카카오뱅크 엑셀 파일은 비밀번호가 필요합니다. (주민번호 앞 6자리)" },
          { status: 400 }
        );
      }
      const wb = new ExcelJS.Workbook();
      // exceljs Buffer type mismatch workaround
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (wb.xlsx.load as any)(arrayBuffer, { password });
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("시트를 읽을 수 없습니다.");

      // 모든 행을 raw value 배열로 변환
      const rows: (string | number | Date | null)[][] = [];
      ws.eachRow((row) => {
        const vals = (row.values ?? []) as (string | number | Date | null)[];
        rows.push(vals.slice(1)); // index 1부터 (exceljs row.values[0]은 빈값)
      });
      txns = parseKakaoExcelRows(rows);

    } else {
      // 신한카드 등 — xlsx로 파싱 (암호 있으면 전달)
      const readOpts: XLSX.ParsingOptions = { type: "buffer", cellDates: true };
      if (password) (readOpts as Record<string, unknown>).password = password;
      const xlsWb = XLSX.read(buffer, readOpts);
      const ws = xlsWb.Sheets[xlsWb.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
      txns = parseShinhanData(rows);
    }

    txns = txns.map((t) => ({ ...t, category: t.category ?? guessCategory(t.description) }));
    return NextResponse.json({ transactions: txns, count: txns.length });

  } catch (e: unknown) {
    const msg = (e as Error).message ?? "파싱 오류";
    // 비밀번호 오류 안내
    if (msg.toLowerCase().includes("password") || msg.includes("암호") || msg.includes("decrypt")) {
      return NextResponse.json(
        { error: "비밀번호가 틀렸거나 암호화 방식이 지원되지 않습니다. 비밀번호를 확인해주세요." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
