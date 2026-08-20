import { positiveIntegerEnv } from "./generation-provider";

export interface ApiResearchEvidenceReasoningEnv {
  readonly KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_RESEARCH_REASONING_TIMEOUT_MS?: string | undefined;
}

export interface ApiResearchEvidenceReasoningOptions {
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

/**
 * Research reasoning gets one generous structured-output budget. A single call avoids paying for
 * and waiting on a complete replay when a reasoning model consumes hidden reasoning tokens.
 */
export function createApiResearchEvidenceReasoningOptions(
  env: ApiResearchEvidenceReasoningEnv = process.env,
): ApiResearchEvidenceReasoningOptions {
  const maxOutputTokens = positiveIntegerEnv(
    env.KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS,
    8_192,
    "KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS",
  );
  return {
    maxOutputTokens,
    timeoutMs: positiveIntegerEnv(
      env.KNOWLEDGE_RESEARCH_REASONING_TIMEOUT_MS,
      60_000,
      "KNOWLEDGE_RESEARCH_REASONING_TIMEOUT_MS",
    ),
  };
}
