export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  source: "kakao" | "shinhan" | "unknown";
  category?: string;
}

// 카카오뱅크 CSV 파싱
// 형식: 거래일시,거래내용,출금(원),입금(원),잔액(원)
export function parseKakaoCSV(text: string): Transaction[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const txns: Transaction[] = [];

  // 헤더 행 찾기
  const headerIdx = lines.findIndex(
    (l) => l.includes("거래일") || l.includes("일시") || l.includes("날짜")
  );
  const dataLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines.slice(1);

  dataLines.forEach((line, i) => {
    // CSV 파싱 (쉼표 구분, 따옴표 처리)
    const cols = parseCSVLine(line);
    if (cols.length < 3) return;

    const dateRaw = cols[0]?.trim() ?? "";
    const desc = cols[1]?.trim() ?? "";
    const outRaw = cols[2]?.replace(/[^0-9-]/g, "") ?? "0";
    const inRaw = cols[3]?.replace(/[^0-9-]/g, "") ?? "0";

    const out = parseInt(outRaw) || 0;
    const inn = parseInt(inRaw) || 0;
    if (out === 0 && inn === 0) return;

    const date = normalizeDate(dateRaw);
    if (!date) return;

    txns.push({
      id: `kakao-${i}-${date}`,
      date,
      description: desc,
      amount: out > 0 ? out : inn,
      type: out > 0 ? "expense" : "income",
      source: "kakao",
    });
  });

  return txns;
}

// 신한카드 엑셀/CSV 파싱
// 형식: 이용일, 이용가맹점, 이용금액, 구분 등
export function parseShinhanData(rows: string[][]): Transaction[] {
  const txns: Transaction[] = [];

  // 헤더 행 찾기
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i].map((c) => String(c ?? "").trim());
    if (
      row.some((c) => c.includes("이용일") || c.includes("승인일") || c.includes("거래일"))
    ) {
      headerIdx = i;
      break;
    }
  }
  const headers = headerIdx >= 0 ? rows[headerIdx].map((c) => String(c ?? "").trim()) : [];
  const dataRows = rows.slice(headerIdx >= 0 ? headerIdx + 1 : 1);

  const dateCol = findColIdx(headers, ["이용일", "승인일", "거래일", "날짜"]);
  const descCol = findColIdx(headers, ["이용가맹점", "가맹점", "내용", "적요", "거래내용"]);
  const amtCol = findColIdx(headers, ["이용금액", "금액", "승인금액"]);

  dataRows.forEach((row, i) => {
    if (row.every((c) => !String(c ?? "").trim())) return;
    const dateRaw = String(row[dateCol] ?? "").trim();
    const desc = String(row[descCol] ?? "").trim();
    const amtRaw = String(row[amtCol] ?? "").replace(/[^0-9]/g, "");
    const amount = parseInt(amtRaw) || 0;
    if (!dateRaw || amount === 0) return;
    const date = normalizeDate(dateRaw);
    if (!date) return;

    txns.push({
      id: `shinhan-${i}-${date}`,
      date,
      description: desc,
      amount,
      type: "expense",
      source: "shinhan",
    });
  });

  return txns;
}

function findColIdx(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex((h) => h.includes(c));
    if (idx >= 0) return idx;
  }
  return 0;
}

function normalizeDate(raw: string): string | null {
  // YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD, YY/MM/DD 등
  const cleaned = raw.replace(/[^0-9]/g, "");
  if (cleaned.length === 8) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  if (cleaned.length === 6) {
    const year = parseInt(cleaned.slice(0, 2)) > 50 ? `19${cleaned.slice(0, 2)}` : `20${cleaned.slice(0, 2)}`;
    return `${year}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 6)}`;
  }
  // Try native Date parse with dashes/slashes
  const attempt = raw.replace(/\./g, "-").replace(/\//g, "-").trim();
  const d = new Date(attempt);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

export const CATEGORIES = [
  "식비", "카페/음료", "쇼핑", "교통", "통신", "의료/건강",
  "문화/여가", "여행", "교육", "뷰티/미용", "마트/편의점",
  "월세/관리비", "공과금", "보험", "구독", "이체", "기타",
];

export function guessCategory(description: string): string {
  const d = description.toLowerCase();
  if (/카페|커피|스타벅스|이디야|메가/.test(d)) return "카페/음료";
  if (/배달|배민|요기요|쿠팡이츠|맥도날드|버거킹|치킨|피자|식당|음식|마라/.test(d)) return "식비";
  if (/쿠팡|네이버쇼핑|11번가|지마켓|옥션|무신사|올리브영/.test(d)) return "쇼핑";
  if (/지하철|버스|택시|카카오t|kt|티머니|주유|주차/.test(d)) return "교통";
  if (/kt|lg|sk|통신|핸드폰|인터넷|통화/.test(d)) return "통신";
  if (/병원|약국|의원|클리닉|한의|치과/.test(d)) return "의료/건강";
  if (/영화|넷플릭스|유튜브|게임|웹툰|공연|전시/.test(d)) return "문화/여가";
  if (/호텔|숙박|에어비|항공|여행/.test(d)) return "여행";
  if (/학원|교육|수강|인강/.test(d)) return "교육";
  if (/미용|헤어|네일|뷰티|화장품/.test(d)) return "뷰티/미용";
  if (/마트|편의점|이마트|홈플|gs25|cu|세븐/.test(d)) return "마트/편의점";
  if (/월세|관리비|임대|렌트/.test(d)) return "월세/관리비";
  if (/전기|가스|수도|공과금/.test(d)) return "공과금";
  if (/보험/.test(d)) return "보험";
  if (/구독|멤버십|프리미엄/.test(d)) return "구독";
  if (/이체|송금|출금/.test(d)) return "이체";
  return "기타";
}
