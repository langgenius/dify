import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";

const WorkflowFailedRetrievalQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(32_000)
  .refine((value) => Array.from(value).length <= 16_000, "Query exceeds 16000 Unicode characters");

const WorkflowRetrievalTraceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) => Array.from(value).length <= 512,
    "Retrieval trace id exceeds 512 Unicode characters",
  );

export const WorkflowFailedRetrievalRequestSchema = z
  .object({
    eventId: z.string().uuid(),
    mode: z.enum(["fast", "deep", "research"]),
    query: WorkflowFailedRetrievalQuerySchema,
    retrievalTraceId: WorkflowRetrievalTraceIdSchema,
  })
  .strict();

export const WorkflowFailedRetrievalResponseSchema = z
  .object({
    badCaseId: z.string().uuid().optional(),
    failedQueryId: z.string().uuid(),
    verdict: z.enum(["retrieval-miss", "coverage-gap", "irrelevant", "uncertain"]),
  })
  .strict();

export const captureWorkflowFailedRetrievalRoute = createRoute({
  method: "post",
  operationId: "captureWorkflowFailedRetrieval",
  path: "/knowledge-spaces/{id}/failed-queries/workflow-retrieval-misses",
  "x-knowledge-fs-max-response-bytes": 1024 * 1024,
  request: {
    body: {
      content: { "application/json": { schema: WorkflowFailedRetrievalRequestSchema } },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: WorkflowFailedRetrievalResponseSchema } },
      description: "Idempotently capture and classify a workflow retrieval with no evidence",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    409: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Event id conflicts with a different workflow retrieval",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Failed-retrieval capture or LLM triage is unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
