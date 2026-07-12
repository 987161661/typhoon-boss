import type { Metadata } from "next";
import { TyphoonMap } from "@/components/TyphoonMap";

export const metadata: Metadata = {
  title: "台风 Boss 雷达 · 专业分析场景",
  description: "常驻渲染的台风专业数据直播场景。"
};

export default function LiveProfessionalPage() {
  return <TyphoonMap view="live" liveDeck="analysis" />;
}
