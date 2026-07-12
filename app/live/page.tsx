import type { Metadata } from "next";
import { LiveDirector } from "@/components/LiveDirector";

export const metadata: Metadata = {
  title: "台风 Boss 雷达 · 直播特供版",
  description: "面向横屏直播的台风结构、路径与卫星证据分析大屏。"
};

export default function LiveRadarPage() {
  return <LiveDirector />;
}
