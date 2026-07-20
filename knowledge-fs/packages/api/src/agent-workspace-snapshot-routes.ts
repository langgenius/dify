import { createRoute } from "@hono/zod-openapi";

import {
  AgentWorkspaceReplayResponseSchema,
  AgentWorkspaceSnapshotParamsSchema,
  AgentWorkspaceSnapshotResponseSchema,
  CreateAgentWorkspaceSnapshotRequestSchema,
} from "./agent-workspace-snapshot-schemas";
import { ForbiddenResponse, UnauthorizedResponse } from "./gateway-openapi-contracts";
import { ErrorResponseSchema } from "./gateway-route-schemas";

export const createAgentWorkspaceSnapshotRoute = createRoute({
  method: "post",
  path: "/agent-workspace-snapshots",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateAgentWorkspaceSnapshotRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: AgentWorkspaceSnapshotResponseSchema,
        },
      },
      description: "Created agent workspace snapshot",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Invalid agent workspace snapshot request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Knowledge space not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const getAgentWorkspaceSnapshotRoute = createRoute({
  method: "get",
  path: "/agent-workspace-snapshots/{id}",
  request: {
    params: AgentWorkspaceSnapshotParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: AgentWorkspaceSnapshotResponseSchema,
        },
      },
      description: "Agent workspace snapshot",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Agent workspace snapshot not found",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});

export const replayAgentWorkspaceSnapshotRoute = createRoute({
  method: "post",
  path: "/agent-workspace-snapshots/{id}/replay",
  request: {
    params: AgentWorkspaceSnapshotParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: AgentWorkspaceReplayResponseSchema,
        },
      },
      description: "Agent workspace snapshot replay",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Agent workspace snapshot not found",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
      description: "Agent workspace snapshot replay failed",
    },
    401: UnauthorizedResponse,
    403: ForbiddenResponse,
  },
});
