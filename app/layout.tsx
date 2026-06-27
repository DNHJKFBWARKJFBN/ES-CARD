import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ES Card — 가계부",
  description: "카카오뱅크 · 신한카드 가계부",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
