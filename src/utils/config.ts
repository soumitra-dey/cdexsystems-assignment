/** Centralized environment configuration. All env-driven knobs live here. */

function boolEnv(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return def;
  return /^(true|1|yes|on)$/i.test(v.trim());
}
function numEnv(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export interface AppConfig {
  replayLlm: boolean;
  seedDir: string;
  caseId: string;
  pipelineNow: string;
  outDir: string;
  transcriptsDir: string;
  packageDir: string;
  maxCostUsdPerRecord: number;
  maxStepsPerRecord: number;
  llmApiKey: string | null;
  llmModel: string | null;
  llmBaseUrl: string | null;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const outDir = overrides.outDir ?? process.env.OUT_DIR ?? "out";
  const pkg =
    overrides.packageDir ?? process.env.PACKAGE_DIR ?? "cedx-appraisals";
  return {
    replayLlm: overrides.replayLlm ?? boolEnv("REPLAY_LLM", true),
    seedDir: overrides.seedDir ?? process.env.SEED_DIR ?? "seed",
    caseId: overrides.caseId ?? process.env.CASE_ID ?? "CEDX-33ACA8",
    pipelineNow:
      overrides.pipelineNow ?? process.env.PIPELINE_NOW ?? "2026-06-26",
    outDir,
    transcriptsDir:
      overrides.transcriptsDir ?? process.env.TRANSCRIPTS_DIR ?? "transcripts",
    packageDir: pkg,
    maxCostUsdPerRecord:
      overrides.maxCostUsdPerRecord ?? numEnv("MAX_COST_USD_PER_RECORD", 0.1),
    maxStepsPerRecord:
      overrides.maxStepsPerRecord ?? numEnv("MAX_STEPS_PER_RECORD", 5),
    llmApiKey: overrides.llmApiKey ?? process.env.LLM_API_KEY ?? null,
    llmModel: overrides.llmModel ?? process.env.LLM_MODEL ?? null,
    llmBaseUrl: overrides.llmBaseUrl ?? process.env.LLM_BASE_URL ?? null,
  };
}

export type { AppConfig as Config };
