import type { Metadata } from "next";
import { ControlConsole } from "@/components/ControlConsole";

export const metadata: Metadata = { title: "气象 Boss 雷达 · 控制台", description: "模型、数据、自动化与可靠性控制台。" };
export default function ConsolePage() { return <ControlConsole />; }
