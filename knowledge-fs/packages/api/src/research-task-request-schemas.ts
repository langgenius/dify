import { z } from "@hono/zod-openapi";

export const CreateResearchTaskSchema = z
  .object({
    budgetUsd: z.number().nonnegative().optional(),
    knowledgeSpaceId: z.string().uuid(),
    limits: z
      .object({
        maxRetrievalSteps: z.number().int().positive().optional(),
        maxScannedResources: z.number().int().positive().optional(),
        maxToolCalls: z.number().int().positive().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .optional(),
    metadata: z.record(z.any()).default({}),
    mode: z
      .enum(["auto", "deep", "fast", "research"])
      .optional()
      .describe(
        "Explicit auto uses the frozen knowledge-space reasoning model once; the durable task stores the resolved mode.",
      ),
    query: z.string().min(1).max(16_000),
    topK: z.number().int().positive().max(50).optional(),
  })
  .strict();

export const PlanResearchTaskSchema = z
  .object({
    budgetUsd: z.number().nonnegative().optional(),
    knowledgeSpaceId: z.string().uuid(),
    mode: z
      .enum(["auto", "deep", "fast", "research"])
      .optional()
      .describe(
        "Explicit auto uses the frozen knowledge-space reasoning model once; retries never reclassify.",
      ),
    query: z.string().min(1).max(16_000),
    topK: z.number().int().positive().max(50).optional(),
  })
  .strict();

export const ResearchTaskJobParamsSchema = z.object({
  id: z.string().min(1),
});

export const ListResearchTaskPartialsQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const ListResearchTaskProgressQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type CreateResearchTaskBody = z.infer<typeof CreateResearchTaskSchema>;
export type PlanResearchTaskBody = z.infer<typeof PlanResearchTaskSchema>;
export type ResearchTaskJobParams = z.infer<typeof ResearchTaskJobParamsSchema>;
export type ListResearchTaskPartialsQuery = z.infer<typeof ListResearchTaskPartialsQuerySchema>;
export type ListResearchTaskProgressQuery = z.infer<typeof ListResearchTaskProgressQuerySchema>;
