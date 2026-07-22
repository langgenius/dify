import { createRoute, z } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  ErrorResponseSchema,
  RetrievalProfileModeErrorResponseSchema,
} from "./gateway-route-schemas";
import {
  CreateResearchTaskSchema,
  ListResearchTaskPartialsQuerySchema,
  ListResearchTaskProgressQuerySchema,
  ListResearchTasksQuerySchema,
  PlanResearchTaskSchema,
  ResearchTaskJobParamsSchema,
  ResearchTaskParentQuerySchema,
  ResearchTaskSpaceParamsSchema,
} from "./research-task-request-schemas";
import {
  ResearchTaskDryRunPlanResponseSchema,
  ResearchTaskJobListResponseSchema,
  ResearchTaskJobResponseSchema,
  ResearchTaskPartialResultListResponseSchema,
} from "./research-task-response-schemas";

export const listKnowledgeSpaceResearchTasksRoute = createRoute({
  method: "get",
  operationId: "listKnowledgeSpaceResearchTasks",
  path: "/knowledge-spaces/{id}/research-tasks",
  tags: ["Research Tasks"],
  request: {
    params: ResearchTaskSpaceParamsSchema,
    query: ListResearchTasksQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: ResearchTaskJobListResponseSchema } },
      description: "Capability-grant-owned Research tasks in one knowledge space",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Invalid Research task list cursor",
    },
    404: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Knowledge space not found",
    },
    503: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Research task listing is unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const planResearchTaskRoute = createRoute({
  method: "post",
  operationId: "planResearchTask",
  path: "/research-tasks/plan",
  request: {
    body: {
      content: {
        "application/json": {
          schema: PlanResearchTaskSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResearchTaskDryRunPlanResponseSchema,
        },
      },
      description: "Dry-run research task plan",
    },
    400: {
      content: {
        "application/json": {
          schema: z.union([RetrievalProfileModeErrorResponseSchema, ErrorResponseSchema]),
        },
      },
      description: "Invalid research task plan request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Published runtime snapshot is unavailable or not query-ready",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const createResearchTaskRoute = createRoute({
  method: "post",
  operationId: "createResearchTask",
  path: "/research-tasks",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateResearchTaskSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: ResearchTaskJobResponseSchema,
        },
      },
      description: "Created research task job",
    },
    400: {
      content: {
        "application/json": {
          schema: z.union([RetrievalProfileModeErrorResponseSchema, ErrorResponseSchema]),
        },
      },
      description: "Invalid research task request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    422: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema.extend({
            violations: z.array(
              z.object({
                estimatedValue: z.number().nonnegative(),
                limit: z.enum([
                  "maxRetrievalSteps",
                  "maxScannedResources",
                  "maxToolCalls",
                  "timeoutMs",
                ]),
                limitValue: z.number().positive(),
              }),
            ),
          }),
        },
      },
      description: "Research task limits exceeded",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Published runtime snapshot is unavailable or not query-ready",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getResearchTaskRoute = createRoute({
  method: "get",
  operationId: "getResearchTask",
  path: "/research-tasks/{id}",
  request: {
    params: ResearchTaskJobParamsSchema,
    query: ResearchTaskParentQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResearchTaskJobResponseSchema,
        },
      },
      description: "Research task job status",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Research task job not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const listResearchTaskPartialsRoute = createRoute({
  method: "get",
  operationId: "listResearchTaskPartials",
  path: "/research-tasks/{id}/partials",
  request: {
    params: ResearchTaskJobParamsSchema,
    query: ListResearchTaskPartialsQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResearchTaskPartialResultListResponseSchema,
        },
      },
      description: "Research task partial evidence bundles",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Research task job not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const streamResearchTaskProgressRoute = createRoute({
  method: "get",
  operationId: "streamResearchTaskProgress",
  path: "/research-tasks/{id}/events",
  request: {
    params: ResearchTaskJobParamsSchema,
    query: ListResearchTaskProgressQuerySchema,
  },
  responses: {
    200: {
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
      description: "Research task progress event stream",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Research task job not found",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Ambiguous Research progress cursor",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const cancelResearchTaskRoute = createRoute({
  method: "delete",
  operationId: "cancelResearchTask",
  path: "/research-tasks/{id}",
  request: {
    params: ResearchTaskJobParamsSchema,
    query: ResearchTaskParentQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: ResearchTaskJobResponseSchema,
        },
      },
      description: "Canceled research task job",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Research task job not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Research task job cannot be canceled",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
