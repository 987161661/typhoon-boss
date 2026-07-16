export type NationalBroadcastCategory = "official_fact" | "observation" | "model";

export interface NationalBroadcastFact {
  ref: string;
  category: NationalBroadcastCategory;
  scope: string;
  statement: string;
  sourceIds: string[];
  dataTime: string | null;
  locations: string[];
  hazards: string[];
  limitations: string[];
  supportsAttribution: boolean;
  supportsDisasterOutcome: boolean;
}

export interface NationalBroadcastPrompt {
  systemPrompt: string;
  request: {
    task: string;
    generatedAt: string;
    snapshotGeneratedAt: string | null;
    facts: NationalBroadcastFact[];
    outputSchema: object;
    outputPolicy: object;
  };
}

export interface NationalBroadcastOutput {
  schemaVersion: 1;
  segments: Array<{
    category: NationalBroadcastCategory;
    text: string;
    factRefs: string[];
  }>;
  closing: string | null;
}

export const NATIONAL_SITUATION_BROADCAST_SCHEMA_VERSION: 1;

export function buildNationalSituationBroadcastPrompt(
  snapshot: unknown,
  options?: { now?: string; maxEvents?: number }
): NationalBroadcastPrompt;

export function validateNationalSituationBroadcast(
  rawValue: unknown,
  prompt: NationalBroadcastPrompt
): { ok: true; value: NationalBroadcastOutput } | { ok: false; errors: string[] };

export function buildDeterministicNationalSituationBroadcast(
  prompt: NationalBroadcastPrompt
): NationalBroadcastOutput;

export function validateLegacyTyphoonNarrative(
  value: unknown
): { ok: true; value: string } | { ok: false; errors: string[] };
