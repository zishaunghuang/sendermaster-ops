import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "SenderMaster · 平台运营",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
