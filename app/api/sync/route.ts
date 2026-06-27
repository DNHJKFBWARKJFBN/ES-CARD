import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get("key");
    if (!key || key.length < 6) return NextResponse.json(null);
    const data = await kv.get(`es:${key}`);
    return NextResponse.json(data ?? null);
  } catch {
    return NextResponse.json(null);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, txns, target } = body;
    if (!key || key.length < 6) return NextResponse.json({ ok: false });
    await kv.set(`es:${key}`, { txns, target }, { ex: 60 * 60 * 24 * 365 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
