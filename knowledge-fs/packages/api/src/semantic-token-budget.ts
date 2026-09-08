import { z } from "zod";

/** Model capabilities are limits, never the model's default completion length. */
export const ModelTokenLimitsSchema = z
  .object({
    contextTokens: z.number().int().positive().max(1_000_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(1_000_000_000).optional(),
    outputParameter: z.string().min(1).max(128).optional(),
  })
  .strict();
export type ModelTokenLimits = z.infer<typeof ModelTokenLimitsSchema>;

/** Frozen with the generation; changing this algorithm requires a new policy version. */
export const SemanticTokenBudgetSchema = z
  .object({
    version: z.literal(1),
    contextTokens: z.number().int().positive().max(1_000_000_000),
    maxOutputTokens: z.number().int().positive().max(1_000_000_000),
    outputParameter: z.string().min(1).max(128).optional(),
    safetyTokens: z.number().int().nonnegative(),
    targetInputTokens: z.number().int().positive(),
    enableGraph: z.boolean(),
    enablePageIndex: z.boolean(),
    source: z.enum(["model", "partial-model", "fallback"]),
    /** Old successful window checkpoints keep their exact v6 layout. */
    legacyWindowLayout: z.boolean(),
  })
  .strict()
  .refine(
    (budget) =>
      budget.safetyTokens < budget.contextTokens && budget.targetInputTokens < budget.contextTokens,
    "Invalid semantic context budget",
  );
export type SemanticTokenBudget = z.infer<typeof SemanticTokenBudgetSchema>;

export function createSemanticTokenBudget(input: {
  readonly limits?: ModelTokenLimits | undefined;
  readonly enableGraph: boolean;
  readonly enablePageIndex: boolean;
  readonly legacyWindowLayout: boolean;
}): SemanticTokenBudget {
  const limits = ModelTokenLimitsSchema.parse(input.limits ?? {});
  // Unknown capacities never imply unlimited context. These are compatibility fallbacks only.
  const contextTokens = limits.contextTokens ?? 16_384;
  const maxOutputTokens = limits.maxOutputTokens ?? 6_000;
  const safetyTokens = Math.min(
    Math.floor(contextTokens / 8),
    Math.max(256, Math.min(4_096, Math.ceil(contextTokens * 0.02))),
  );
  return SemanticTokenBudgetSchema.parse({
    version: 1,
    contextTokens,
    maxOutputTokens,
    ...(limits.outputParameter ? { outputParameter: limits.outputParameter } : {}),
    safetyTokens,
    // A latency/fairness ceiling, not a claimed model context limit. Do not fill million-token
    // contexts just because they are available. Output-heavy inputs are bounded further below.
    targetInputTokens: Math.max(
      1,
      Math.min(32_768, Math.floor((contextTokens - safetyTokens) / 2)),
    ),
    enableGraph: input.enableGraph,
    enablePageIndex: input.enablePageIndex,
    legacyWindowLayout: input.legacyWindowLayout,
    source:
      limits.contextTokens && limits.maxOutputTokens
        ? "model"
        : limits.contextTokens || limits.maxOutputTokens
          ? "partial-model"
          : "fallback",
  });
}

export function semanticOutputCeiling(budget: SemanticTokenBudget, inputTokens: number): number {
  // Response-memory and latency protection remains independent of provider capability.
  return Math.max(
    0,
    Math.min(
      budget.maxOutputTokens,
      65_536,
      budget.contextTokens - budget.safetyTokens - inputTokens,
    ),
  );
}

export function estimateSemanticOutputTokens(input: {
  readonly budget: SemanticTokenBudget;
  readonly unitCount: number;
  readonly textTokens: number;
}): number {
  // Joint JSON output has a per-unit structural cost plus text-dependent facts/summaries.
  // Reserve headroom for reasoning/formatting; actual provider usage is reported separately.
  const perUnit =
    64 + (input.budget.enableGraph ? 192 : 0) + (input.budget.enablePageIndex ? 64 : 0);
  const textFactor = (input.budget.enableGraph ? 1 : 0) + (input.budget.enablePageIndex ? 0.5 : 0);
  return Math.ceil(256 + input.unitCount * perUnit + input.textTokens * textFactor);
}
