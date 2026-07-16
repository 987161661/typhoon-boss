import type { Metadata } from "next";
import { TyphoonMap } from "@/components/TyphoonMap";

export const metadata: Metadata = {
  title: "气象 Boss 雷达 · 观众态势场景",
  description: "常驻渲染的台风观众态势直播场景。"
};

export default function LiveSituationPage() {
  return <TyphoonMap view="live" liveDeck="briefing" />;
}
