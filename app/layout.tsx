import type { Metadata } from "next";
import { CHUNK_LOAD_RECOVERY_SCRIPT } from "@/lib/chunkLoadRecovery";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "气象 Boss 雷达",
  description: "全国预警、雷达与环境态势优先，并保留完整台风指挥能力的中文气象大屏。"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_LOAD_RECOVERY_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
