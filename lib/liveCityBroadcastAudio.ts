"use client";

import type { LiveCityReportEffectsVolume } from "./liveControlSettings";

export type LiveCityBroadcastCue = "lock" | "battle" | "info" | "stamp" | "archive" | "type";

export interface LiveCityBroadcastEffects {
  enabled: boolean;
  volume: LiveCityReportEffectsVolume;
}

export const LIVE_CITY_BROADCAST_VOLUME: Record<LiveCityReportEffectsVolume, number> = {
  low: 0.35,
  standard: 0.65,
  high: 1
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

export function primeLiveCityBroadcastAudio() {
  try {
    const context = getAudioContext();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
  } catch {
    // Autoplay policy and missing audio devices must never block the broadcast.
  }
}

export function playLiveCityBroadcastCue(
  cue: LiveCityBroadcastCue,
  effects: LiveCityBroadcastEffects
) {
  if (!effects.enabled) return;
  try {
    const context = getAudioContext();
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    if (!masterGain) return;
    masterGain.gain.setValueAtTime(LIVE_CITY_BROADCAST_VOLUME[effects.volume], context.currentTime);
    const start = context.currentTime;
    if (cue === "type") {
      tone(context, masterGain, { start, duration: 0.04, type: "triangle", from: 1_340, to: 980, peak: 0.042 });
      return;
    }
    if (cue === "lock") {
      tone(context, masterGain, { start, duration: 0.12, type: "sine", from: 740, to: 1_120, peak: 0.07 });
      tone(context, masterGain, { start: start + 0.09, duration: 0.045, type: "square", from: 1_820, to: 1_420, peak: 0.026 });
      return;
    }
    if (cue === "battle") {
      tone(context, masterGain, { start, duration: 0.34, type: "sine", from: 118, to: 46, peak: 0.14 });
      tone(context, masterGain, { start: start + 0.055, duration: 0.15, type: "triangle", from: 680, to: 190, peak: 0.065 });
      return;
    }
    if (cue === "info") {
      tone(context, masterGain, { start, duration: 0.28, type: "sine", from: 420, to: 1_180, peak: 0.095 });
      tone(context, masterGain, { start: start + 0.19, duration: 0.09, type: "triangle", from: 1_520, to: 1_240, peak: 0.07 });
      return;
    }
    if (cue === "stamp") {
      tone(context, masterGain, { start, duration: 0.13, type: "square", from: 220, to: 150, peak: 0.065 });
      tone(context, masterGain, { start: start + 0.16, duration: 0.13, type: "square", from: 235, to: 160, peak: 0.055 });
      return;
    }
    tone(context, masterGain, { start, duration: 0.18, type: "triangle", from: 260, to: 740, peak: 0.055 });
    tone(context, masterGain, { start: start + 0.16, duration: 0.16, type: "sine", from: 880, to: 1_320, peak: 0.06 });
  } catch {
    // Decorative sound silently degrades when Web Audio is unavailable.
  }
}

function getAudioContext() {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
    masterGain = audioContext.createGain();
    masterGain.gain.value = LIVE_CITY_BROADCAST_VOLUME.standard;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

function tone(
  context: AudioContext,
  destination: AudioNode,
  options: {
    start: number;
    duration: number;
    type: OscillatorType;
    from: number;
    to: number;
    peak: number;
  }
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const end = options.start + options.duration;
  oscillator.type = options.type;
  oscillator.frequency.setValueAtTime(options.from, options.start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, options.to), end);
  gain.gain.setValueAtTime(0.0001, options.start);
  gain.gain.exponentialRampToValueAtTime(options.peak, options.start + Math.min(0.012, options.duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(options.start);
  oscillator.stop(end + 0.01);
}
