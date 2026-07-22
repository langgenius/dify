import { createRoute } from "@hono/zod-openapi";

import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import {
  CandidateVisibilityScanBudgetExceededResponseSchema,
  ErrorResponseSchema,
} from "./gateway-route-schemas";
import {
  KnowledgeFsDiffQuerySchema,
  KnowledgeFsFindQuerySchema,
  KnowledgeFsGrepQuerySchema,
  KnowledgeFsOpenNodeQuerySchema,
  KnowledgeFsPathQuerySchema,
  KnowledgeFsWriteBodySchema,
} from "./knowledge-fs-request-schemas";
import {
  KnowledgeFsCatResponseSchema,
  KnowledgeFsDiffResponseSchema,
  KnowledgeFsGrepResponseSchema,
  KnowledgeFsListResponseSchema,
  KnowledgeFsOpenNodeResponseSchema,
  KnowledgeFsStatResponseSchema,
  KnowledgeFsTreeResponseSchema,
  KnowledgeFsWriteResponseSchema,
} from "./knowledge-fs-response-schemas";
import { KnowledgeSpaceParamsSchema } from "./knowledge-space-golden-question-schemas";

const CandidateVisibilityScanBudgetExceededResponse = {
  content: {
    "application/json": {
      schema: CandidateVisibilityScanBudgetExceededResponseSchema,
    },
  },
  description: "Candidate visibility scan budget exceeded",
} as const;

export const listKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/ls",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsPathQuerySchema.omit({ depth: true }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsListResponseSchema,
        },
      },
      description: "KnowledgeFS directory listing",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid KnowledgeFS list request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: CandidateVisibilityScanBudgetExceededResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const treeKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/tree",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsPathQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsTreeResponseSchema,
        },
      },
      description: "KnowledgeFS directory tree",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid KnowledgeFS tree request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: CandidateVisibilityScanBudgetExceededResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const grepKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/grep",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsGrepQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsGrepResponseSchema,
        },
      },
      description: "KnowledgeFS scoped text search",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid KnowledgeFS grep request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: CandidateVisibilityScanBudgetExceededResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const findKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/find",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsFindQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsListResponseSchema,
        },
      },
      description: "KnowledgeFS scoped metadata search",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid KnowledgeFS find request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    503: CandidateVisibilityScanBudgetExceededResponse,
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const diffKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/diff",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsDiffQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsDiffResponseSchema,
        },
      },
      description: "KnowledgeFS text diff",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid KnowledgeFS diff request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeFS path not found",
    },
    503: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeFS diff unavailable",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const openNodeKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/open_node",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsOpenNodeQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsOpenNodeResponseSchema,
        },
      },
      description: "Citation-ready KnowledgeFS node",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeFS node not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const catKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/cat",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsPathQuerySchema.pick({
      consistencyClass: true,
      cursor: true,
      limit: true,
      path: true,
    }).partial({
      consistencyClass: true,
      cursor: true,
      limit: true,
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsCatResponseSchema,
        },
      },
      description: "KnowledgeFS file content",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeFS path not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const statKnowledgeFsRoute = createRoute({
  method: "get",
  path: "/knowledge-spaces/{id}/fs/stat",
  request: {
    params: KnowledgeSpaceParamsSchema,
    query: KnowledgeFsPathQuerySchema.pick({ consistencyClass: true, path: true }).partial({
      consistencyClass: true,
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsStatResponseSchema,
        },
      },
      description: "KnowledgeFS path metadata",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeFS path not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const writeKnowledgeFsRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/fs/write",
  request: {
    body: {
      content: {
        "application/json": {
          schema: KnowledgeFsWriteBodySchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsWriteResponseSchema,
        },
      },
      description: "KnowledgeFS file overwritten",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid KnowledgeFS write request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeFS path not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space document mutation is fenced by publication bootstrap",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const appendKnowledgeFsRoute = createRoute({
  method: "post",
  path: "/knowledge-spaces/{id}/fs/append",
  request: {
    body: {
      content: {
        "application/json": {
          schema: KnowledgeFsWriteBodySchema,
        },
      },
      required: true,
    },
    params: KnowledgeSpaceParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: KnowledgeFsWriteResponseSchema,
        },
      },
      description: "KnowledgeFS file appended",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid KnowledgeFS append request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "KnowledgeFS path not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space document mutation is fenced by publication bootstrap",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
