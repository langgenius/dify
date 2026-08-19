import { positiveIntegerEnv } from "./generation-provider";

export interface ApiResearchEvidenceReasoningEnv {
  readonly KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_RESEARCH_REASONING_RECOVERY_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_RESEARCH_REASONING_TIMEOUT_MS?: string | undefined;
}

export interface ApiResearchEvidenceReasoningOptions {
  readonly maxOutputTokens: number;
  readonly recoveryMaxOutputTokens: number;
  readonly timeoutMs: number;
}

/**
 * Research judgement uses a small normal budget and one larger recovery budget. The second call
 * is made only when the provider proves that the first structured response was truncated.
 */
export function createApiResearchEvidenceReasoningOptions(
  env: ApiResearchEvidenceReasoningEnv = process.env,
): ApiResearchEvidenceReasoningOptions {
  const maxOutputTokens = positiveIntegerEnv(
    env.KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS,
    2_048,
    "KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS",
  );
  const recoveryMaxOutputTokens = positiveIntegerEnv(
    env.KNOWLEDGE_RESEARCH_REASONING_RECOVERY_MAX_OUTPUT_TOKENS,
    4_096,
    "KNOWLEDGE_RESEARCH_REASONING_RECOVERY_MAX_OUTPUT_TOKENS",
  );
  if (recoveryMaxOutputTokens < maxOutputTokens) {
    throw new Error(
      "KNOWLEDGE_RESEARCH_REASONING_RECOVERY_MAX_OUTPUT_TOKENS must be at least KNOWLEDGE_RESEARCH_REASONING_MAX_OUTPUT_TOKENS",
    );
  }
  return {
    maxOutputTokens,
    recoveryMaxOutputTokens,
    timeoutMs: positiveIntegerEnv(
      env.KNOWLEDGE_RESEARCH_REASONING_TIMEOUT_MS,
      60_000,
      "KNOWLEDGE_RESEARCH_REASONING_TIMEOUT_MS",
    ),
  };
}
