import { z } from "@hono/zod-openapi";
import { type KnowledgeFsckReport, KnowledgePathSchema } from "@knowledge/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  KnowledgeMcpWorkspaceSnapshotCreateInputSchema,
  KnowledgeMcpWorkspaceSnapshotGetInputSchema,
  KnowledgeMcpWorkspaceSnapshotReplayInputSchema,
} from "./agent-workspace-snapshot-schemas";
import {
  AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY,
  AUTO_RETRIEVAL_MODE_MAX_QUERY_LENGTH,
  type RetrievalModeRequestResolution,
  resolveRetrievalModeRequest,
} from "./auto-retrieval-mode-resolver";
import {
  authorizeAgentWorkspaceDerivedResult,
  authorizeResearchTaskDerivedResult,
  issueKnowledgeSpaceDurablePermission,
  toMcpPublicDerivedResult,
  toPublicAgentWorkspaceReplay,
  toPublicAgentWorkspaceSnapshot,
  toPublicResearchTaskJob,
} from "./derived-result-authorization";
import { omitKnowledgeFsReservedMetadata } from "./knowledge-fs-reserved-metadata";
import {
  KNOWLEDGE_MCP_DOCUMENT_TOOLS,
  KNOWLEDGE_MCP_OPERATOR_TOOLS,
  KNOWLEDGE_MCP_RESEARCH_TOOLS,
  KNOWLEDGE_MCP_TOOLS,
  KNOWLEDGE_MCP_WORKSPACE_REPLAY_TOOLS,
  KNOWLEDGE_MCP_WORKSPACE_SNAPSHOT_TOOLS,
  type KnowledgeMcpPermissionContext,
  type KnowledgeMcpServer,
  type KnowledgeMcpServerOptions,
  type KnowledgeMcpToolName,
} from "./knowledge-mcp-types";
import type { PublishedKnowledgeSpaceRuntimeSnapshot } from "./published-knowledge-space-runtime-snapshot";
import type { ResearchTaskDryRunPlan } from "./research-task-planning";
import {
  RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY,
  captureResearchTaskRuntimeSnapshotPayload,
} from "./research-task-runtime-snapshot";

class KnowledgeMcpConfigurationError extends Error {}

const KnowledgeMcpKnowledgeSpaceIdSchema = z.string().uuid();
const KnowledgeMcpSnapshotFingerprintSchema = z.string().regex(/^snapshot-sha256:[a-f0-9]{64}$/);
const KnowledgeMcpPathSchema = z
  .string()
  .regex(/^\/(?:sources|knowledge|evidence|workspaces)(?:\/[^/\s]+)*$/);
const KnowledgeMcpFsListInputSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    depth: z.number().int().min(1).optional(),
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
    limit: z.number().int().min(1),
    path: KnowledgeMcpPathSchema,
    snapshotFingerprint: KnowledgeMcpSnapshotFingerprintSchema.optional(),
  })
  .strict();
const KnowledgeMcpFsCatInputSchema = z
  .object({
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
    path: KnowledgeMcpPathSchema,
    snapshotFingerprint: KnowledgeMcpSnapshotFingerprintSchema.optional(),
  })
  .strict();
const KnowledgeMcpFsGrepInputSchema = KnowledgeMcpFsListInputSchema.extend({
  q: z.string().trim().min(1).max(4000),
}).strict();
const KnowledgeMcpFsFindInputSchema = KnowledgeMcpFsListInputSchema.extend({
  metadataKey: z.string().min(1).max(120).optional(),
  metadataValue: z.string().min(1).max(4000).optional(),
  nameContains: z.string().min(1).max(240).optional(),
  resourceType: KnowledgePathSchema.shape.resourceType.optional(),
}).strict();
const KnowledgeMcpFsDiffInputSchema = z
  .object({
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
    mode: z.enum(["line", "word"]).optional(),
    newPath: KnowledgeMcpPathSchema,
    oldPath: KnowledgeMcpPathSchema,
    snapshotFingerprint: KnowledgeMcpSnapshotFingerprintSchema.optional(),
  })
  .strict();
const KnowledgeMcpFsOpenNodeInputSchema = z
  .object({
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
    nodeId: z.string().uuid(),
    snapshotFingerprint: KnowledgeMcpSnapshotFingerprintSchema.optional(),
  })
  .strict();
const KnowledgeMcpSearchInputSchema = z
  .object({
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
    mode: z.enum(["auto", "deep", "fast", "research"]).optional(),
    query: z.string().trim().min(1).max(AUTO_RETRIEVAL_MODE_MAX_QUERY_LENGTH),
    snapshotFingerprint: KnowledgeMcpSnapshotFingerprintSchema.optional(),
    topK: z.number().int().min(1),
  })
  .strict();
const KnowledgeMcpShellInputSchema = z
  .object({
    command: z.string().trim().min(1).max(4000),
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
    snapshotFingerprint: KnowledgeMcpSnapshotFingerprintSchema.optional(),
  })
  .strict();
const KnowledgeMcpSpaceStatusInputSchema = z
  .object({
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
  })
  .strict();
const KnowledgeMcpDocumentOutlineInputSchema = z
  .object({
    documentId: z.string().uuid(),
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
  })
  .strict();
const KnowledgeMcpFsckInputSchema = z
  .object({
    check: z.enum(["artifact-segments", "raw-objects", "references"]).default("raw-objects"),
    cursor: z.string().min(1).max(1024).optional(),
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
  })
  .strict();
const KnowledgeMcpResearchPlanInputSchema = z
  .object({
    budgetUsd: z.number().nonnegative().optional(),
    knowledgeSpaceId: KnowledgeMcpKnowledgeSpaceIdSchema,
    mode: z.enum(["auto", "deep", "fast", "research"]).optional(),
    query: z.string().trim().min(1).max(16_000),
    topK: z.number().int().min(1).optional(),
  })
  .strict();
const KnowledgeMcpResearchCreateInputSchema = KnowledgeMcpResearchPlanInputSchema.extend({
  limits: z
    .object({
      maxRetrievalSteps: z.number().int().positive().optional(),
      maxScannedResources: z.number().int().positive().optional(),
      maxToolCalls: z.number().int().positive().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),
  metadata: z.record(z.any()).optional(),
}).strict();
const KnowledgeMcpResearchJobInputSchema = z
  .object({
    id: z.string().trim().min(1).max(240),
  })
  .strict();

function assertPositiveMcpBound(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new KnowledgeMcpConfigurationError(`${name} must be an integer >= 1`);
  }
}

function toMcpToolResult(structuredContent: object): CallToolResult {
  return {
    content: [
      {
        text: JSON.stringify(structuredContent),
        type: "text",
      },
    ],
    structuredContent: structuredContent as Record<string, unknown>,
  };
}

function limitFsckReportIssues(
  report: KnowledgeFsckReport,
  maxIssues: number,
): KnowledgeFsckReport & { readonly truncated: boolean } {
  return {
    ...report,
    issues: report.issues.slice(0, maxIssues),
    truncated: report.issues.length > maxIssues,
  };
}

function assertMcpFsLimit(limit: number, maxFsListLimit: number): void {
  if (limit > maxFsListLimit) {
    throw new Error(`MCP fs list limit exceeds maxFsListLimit=${maxFsListLimit}`);
  }
}

function assertMcpResearchTopK(topK: number | undefined, maxResearchTopK: number): void {
  if (topK !== undefined && topK > maxResearchTopK) {
    throw new Error(`MCP research topK exceeds maxResearchTopK=${maxResearchTopK}`);
  }
}

export function createKnowledgeMcpServer(options: KnowledgeMcpServerOptions): KnowledgeMcpServer {
  const maxFsListLimit = options.maxFsListLimit ?? 100;
  const maxOperatorIssues = options.maxOperatorIssues ?? 20;
  const maxResearchTopK = options.maxResearchTopK ?? options.maxSearchTopK ?? 50;
  const maxSearchTopK = options.maxSearchTopK ?? 50;
  const permissionSnapshotTtlMs = options.authorization.permissionSnapshotTtlMs ?? 60 * 60_000;
  assertPositiveMcpBound("maxFsListLimit", maxFsListLimit);
  assertPositiveMcpBound("maxOperatorIssues", maxOperatorIssues);
  assertPositiveMcpBound("maxResearchTopK", maxResearchTopK);
  assertPositiveMcpBound("maxSearchTopK", maxSearchTopK);
  assertPositiveMcpBound("authorization.permissionSnapshotTtlMs", permissionSnapshotTtlMs);
  if ((options.research || options.workspaceSnapshots) && !options.authorization.access) {
    throw new KnowledgeMcpConfigurationError(
      "authorization.access is required for durable Research and Workspace MCP tools",
    );
  }

  const durableAccess = () => {
    const access = options.authorization.access;
    if (!access) {
      throw new KnowledgeMcpConfigurationError(
        "authorization.access is required for durable Research and Workspace MCP tools",
      );
    }
    return access;
  };

  const authorizeSpace = async <T extends { readonly knowledgeSpaceId: string }>(
    input: T,
    requiredAccess: "admin" | "read" | "write",
  ): Promise<T & { readonly permissionScope?: readonly string[] | undefined }> => {
    const decision = await options.authorization.guard.authorize({
      callerKind: "mcp",
      knowledgeSpaceId: input.knowledgeSpaceId,
      requiredAccess,
      subject: options.authorization.subject,
    });
    return { ...input, permissionScope: [...decision.permissionSnapshot.candidateGrants] };
  };

  const issueDurablePermission = async <T extends { readonly knowledgeSpaceId: string }>(
    input: T,
    requiredAccess: "read" | "write",
  ): Promise<T & KnowledgeMcpPermissionContext> => {
    const access = durableAccess();
    const snapshot = await issueKnowledgeSpaceDurablePermission({
      access,
      authorization: options.authorization.guard,
      callerKind: "mcp",
      expiresAt: new Date(
        (options.authorization.now ?? Date.now)() + permissionSnapshotTtlMs,
      ).toISOString(),
      knowledgeSpaceId: input.knowledgeSpaceId,
      requiredAccess,
      subject: options.authorization.subject,
    });
    return {
      ...input,
      durablePermission: {
        accessChannel: snapshot.accessChannel,
        id: snapshot.id,
        revision: snapshot.revision,
        subjectId: snapshot.subjectId,
        tenantId: snapshot.tenantId,
      },
      permissionScope: [...snapshot.permissionScopes],
    };
  };

  const resolveMcpRetrievalMode = async (input: {
    readonly knowledgeSpaceId: string;
    readonly mode?: "auto" | "deep" | "fast" | "research" | undefined;
    readonly query: string;
  }): Promise<
    | {
        readonly resolution: RetrievalModeRequestResolution;
        readonly runtimeSnapshot: PublishedKnowledgeSpaceRuntimeSnapshot;
      }
    | undefined
  > => {
    if (!options.runtimeSnapshotResolver) {
      if (input.mode !== "auto") return undefined;
      throw new KnowledgeMcpConfigurationError(
        "MCP auto retrieval mode requires a published runtime snapshot resolver",
      );
    }
    const snapshot = await options.runtimeSnapshotResolver.resolve({
      knowledgeSpaceId: input.knowledgeSpaceId,
      tenantId: options.authorization.subject.tenantId,
    });
    const requestedMode = input.mode ?? snapshot.retrievalProfile.defaultMode;
    return {
      resolution: await resolveRetrievalModeRequest({
        fallbackMode: snapshot.retrievalProfile.defaultMode,
        query: input.query,
        reasoningModel: snapshot.retrievalProfile.reasoningModel,
        requestedMode,
        resolver: options.autoRetrievalModeResolver,
        tenantId: options.authorization.subject.tenantId,
      }),
      runtimeSnapshot: snapshot,
    };
  };

  const server = new McpServer({
    name: "knowledge-fs",
    version: "0.1.0",
  });

  const handlers: Partial<
    Record<KnowledgeMcpToolName, (input: unknown) => Promise<CallToolResult>>
  > = {
    "knowledge.fetch_evidence": async (input) => {
      const parsed = KnowledgeMcpSearchInputSchema.parse(input);
      if (parsed.topK > maxSearchTopK) {
        throw new Error(`MCP fetch_evidence topK exceeds maxSearchTopK=${maxSearchTopK}`);
      }
      const authorized = await authorizeSpace(parsed, "read");
      const modeRoute = await resolveMcpRetrievalMode(authorized);
      return toMcpToolResult(
        await options.fetchEvidence({
          ...authorized,
          ...(modeRoute
            ? {
                mode: modeRoute.resolution.resolvedMode,
                runtimeSnapshot: modeRoute.runtimeSnapshot,
              }
            : {}),
        }),
      );
    },
    "knowledge.fs.cat": async (input) => {
      const parsed = KnowledgeMcpFsCatInputSchema.parse(input);
      return toMcpToolResult(await options.fs.cat(await authorizeSpace(parsed, "read")));
    },
    "knowledge.fs.diff": async (input) => {
      const parsed = KnowledgeMcpFsDiffInputSchema.parse(input);
      return toMcpToolResult(await options.fs.diff(await authorizeSpace(parsed, "read")));
    },
    "knowledge.fs.find": async (input) => {
      const parsed = KnowledgeMcpFsFindInputSchema.parse(input);
      assertMcpFsLimit(parsed.limit, maxFsListLimit);
      return toMcpToolResult(await options.fs.find(await authorizeSpace(parsed, "read")));
    },
    "knowledge.fs.grep": async (input) => {
      const parsed = KnowledgeMcpFsGrepInputSchema.parse(input);
      assertMcpFsLimit(parsed.limit, maxFsListLimit);
      return toMcpToolResult(await options.fs.grep(await authorizeSpace(parsed, "read")));
    },
    "knowledge.fs.ls": async (input) => {
      const parsed = KnowledgeMcpFsListInputSchema.parse(input);
      assertMcpFsLimit(parsed.limit, maxFsListLimit);
      return toMcpToolResult(await options.fs.ls(await authorizeSpace(parsed, "read")));
    },
    "knowledge.fs.open_node": async (input) => {
      const parsed = KnowledgeMcpFsOpenNodeInputSchema.parse(input);
      return toMcpToolResult(await options.fs.openNode(await authorizeSpace(parsed, "read")));
    },
    "knowledge.fs.stat": async (input) => {
      const parsed = KnowledgeMcpFsCatInputSchema.parse(input);
      return toMcpToolResult(await options.fs.stat(await authorizeSpace(parsed, "read")));
    },
    "knowledge.fs.tree": async (input) => {
      const parsed = KnowledgeMcpFsListInputSchema.parse(input);
      assertMcpFsLimit(parsed.limit, maxFsListLimit);
      return toMcpToolResult(await options.fs.tree(await authorizeSpace(parsed, "read")));
    },
    "knowledge.search": async (input) => {
      const parsed = KnowledgeMcpSearchInputSchema.parse(input);
      if (parsed.topK > maxSearchTopK) {
        throw new Error(`MCP search topK exceeds maxSearchTopK=${maxSearchTopK}`);
      }
      const authorized = await authorizeSpace(parsed, "read");
      const modeRoute = await resolveMcpRetrievalMode(authorized);
      return toMcpToolResult(
        await options.search({
          ...authorized,
          ...(modeRoute
            ? {
                mode: modeRoute.resolution.resolvedMode,
                runtimeSnapshot: modeRoute.runtimeSnapshot,
              }
            : {}),
        }),
      );
    },
    "knowledge.shell.execute": async (input) => {
      const parsed = KnowledgeMcpShellInputSchema.parse(input);
      return toMcpToolResult(await options.shell.execute(await authorizeSpace(parsed, "write")));
    },
    "knowledge.shell.plan": async (input) => {
      const parsed = KnowledgeMcpShellInputSchema.parse(input);
      return toMcpToolResult(await options.shell.plan(await authorizeSpace(parsed, "read")));
    },
  };

  const documents = options.documents;

  if (documents) {
    handlers["knowledge.get_document_outline"] = async (input) => {
      const parsed = KnowledgeMcpDocumentOutlineInputSchema.parse(input);
      return toMcpToolResult(
        (await documents.getOutline(await authorizeSpace(parsed, "read"))) ?? {
          error: "Not found",
        },
      );
    };
  }

  const operator = options.operator;

  if (operator) {
    handlers["knowledge.space.status"] = async (input) => {
      const parsed = KnowledgeMcpSpaceStatusInputSchema.parse(input);
      return toMcpToolResult(await operator.status(await authorizeSpace(parsed, "admin")));
    };
    handlers["knowledge.fsck"] = async (input) => {
      const parsed = KnowledgeMcpFsckInputSchema.parse(input);
      const report = await operator.fsck(await authorizeSpace(parsed, "admin"));
      return toMcpToolResult(limitFsckReportIssues(report, maxOperatorIssues));
    };
  }

  const research = options.research;

  if (research) {
    handlers["knowledge.research.cancel"] = async (input) => {
      const parsed = KnowledgeMcpResearchJobInputSchema.parse(input);
      const existing = await research.get(parsed);
      if (!existing) {
        return toMcpToolResult({ error: "Not found" });
      }
      await authorizeResearchTaskDerivedResult({
        access: durableAccess(),
        authorization: options.authorization.guard,
        callerKind: "mcp",
        job: existing,
        requiredAccess: "write",
        subject: options.authorization.subject,
      });
      const canceled = await research.cancel(parsed);
      if (!canceled) {
        return toMcpToolResult({ error: "Not found" });
      }
      await authorizeResearchTaskDerivedResult({
        access: durableAccess(),
        authorization: options.authorization.guard,
        callerKind: "mcp",
        job: canceled,
        requiredAccess: "write",
        subject: options.authorization.subject,
      });
      return toMcpToolResult(toMcpPublicDerivedResult(toPublicResearchTaskJob(canceled)));
    };
    handlers["knowledge.research.create"] = async (input) => {
      const parsed = KnowledgeMcpResearchCreateInputSchema.parse(input);
      assertMcpResearchTopK(parsed.topK, maxResearchTopK);
      const authorized = await issueDurablePermission(parsed, "write");
      const modeRoute = await resolveMcpRetrievalMode(authorized);
      const modeResolution = modeRoute?.resolution;
      const frozenTopK = authorized.topK ?? modeRoute?.runtimeSnapshot.retrievalProfile.topK;
      const plan =
        options.runtimeSnapshotResolver || modeResolution
          ? await research.plan({
              ...authorized,
              ...(modeResolution
                ? {
                    mode: modeResolution.requestedMode,
                    resolvedMode: modeResolution.resolvedMode,
                    runtimeSnapshot: modeRoute?.runtimeSnapshot,
                  }
                : {}),
              ...(frozenTopK === undefined ? {} : { topK: frozenTopK }),
            })
          : undefined;
      if (modeResolution && plan?.retrievalPlan.resolvedMode !== modeResolution.resolvedMode) {
        throw new KnowledgeMcpConfigurationError(
          "MCP Research planner did not preserve the server-resolved retrieval mode",
        );
      }
      const callerMetadata = omitKnowledgeFsReservedMetadata(parsed.metadata ?? {});
      const runtimeSnapshotPayload = options.runtimeSnapshotResolver
        ? await captureResearchTaskRuntimeSnapshotPayload({
            knowledgeSpaceId: parsed.knowledgeSpaceId,
            resolvedMode: (plan as ResearchTaskDryRunPlan).retrievalPlan.resolvedMode,
            resolver: options.runtimeSnapshotResolver,
            ...(modeRoute ? { snapshot: modeRoute.runtimeSnapshot } : {}),
            tenantId: options.authorization.subject.tenantId,
          })
        : undefined;
      const metadata = {
        ...callerMetadata,
        ...(modeResolution?.requestedMode === "auto"
          ? {
              [AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]: {
                degraded: modeResolution.degraded,
                durationMs: modeResolution.durationMs,
                ...(modeResolution.errorClass ? { errorClass: modeResolution.errorClass } : {}),
                ...(modeResolution.finishReason
                  ? { finishReason: modeResolution.finishReason }
                  : {}),
                ...(modeResolution.generationModel
                  ? { generationModel: modeResolution.generationModel }
                  : {}),
                ...(modeResolution.promptVersion
                  ? { promptVersion: modeResolution.promptVersion }
                  : {}),
                ...(modeResolution.provider ? { provider: modeResolution.provider } : {}),
                ...(modeResolution.reasonCode ? { reasonCode: modeResolution.reasonCode } : {}),
                ...(modeRoute
                  ? {
                      publicationFingerprint:
                        modeRoute.runtimeSnapshot.projectionSnapshot.fingerprint,
                      publicationId: modeRoute.runtimeSnapshot.projectionSnapshot.publicationId,
                      reasoningModel: {
                        ...modeRoute.runtimeSnapshot.retrievalProfile.reasoningModel,
                      },
                      retrievalProfileRevision: modeRoute.runtimeSnapshot.retrievalProfile.revision,
                    }
                  : {}),
                requestedMode: modeResolution.requestedMode,
                resolvedMode: modeResolution.resolvedMode,
                resolver: modeResolution.resolver,
                ...(modeResolution.usage ? { usage: modeResolution.usage } : {}),
              },
            }
          : {}),
        ...(runtimeSnapshotPayload
          ? { [RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY]: runtimeSnapshotPayload }
          : {}),
      };
      const created = await research.create({
        ...authorized,
        ...(plan ? { mode: plan.retrievalPlan.resolvedMode } : {}),
        ...(modeRoute ? { runtimeSnapshot: modeRoute.runtimeSnapshot } : {}),
        ...(plan ? { topK: plan.retrievalPlan.topK } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
      await authorizeResearchTaskDerivedResult({
        access: durableAccess(),
        authorization: options.authorization.guard,
        callerKind: "mcp",
        job: created,
        requiredAccess: "write",
        subject: options.authorization.subject,
      });
      return toMcpToolResult(toMcpPublicDerivedResult(toPublicResearchTaskJob(created)));
    };
    handlers["knowledge.research.get"] = async (input) => {
      const parsed = KnowledgeMcpResearchJobInputSchema.parse(input);
      const existing = await research.get(parsed);
      if (!existing) {
        return toMcpToolResult({ error: "Not found" });
      }
      await authorizeResearchTaskDerivedResult({
        access: durableAccess(),
        authorization: options.authorization.guard,
        callerKind: "mcp",
        job: existing,
        requiredAccess: "read",
        subject: options.authorization.subject,
      });
      return toMcpToolResult(toMcpPublicDerivedResult(toPublicResearchTaskJob(existing)));
    };
    handlers["knowledge.research.plan"] = async (input) => {
      const parsed = KnowledgeMcpResearchPlanInputSchema.parse(input);
      assertMcpResearchTopK(parsed.topK, maxResearchTopK);
      const authorized = await authorizeSpace(parsed, "read");
      const modeRoute = await resolveMcpRetrievalMode(authorized);
      const modeResolution = modeRoute?.resolution;
      return toMcpToolResult(
        await research.plan({
          ...authorized,
          ...(modeResolution
            ? {
                mode: modeResolution.requestedMode,
                resolvedMode: modeResolution.resolvedMode,
                runtimeSnapshot: modeRoute?.runtimeSnapshot,
              }
            : {}),
        }),
      );
    };
  }
  const workspaceSnapshots = options.workspaceSnapshots;

  if (workspaceSnapshots) {
    handlers["knowledge.workspace_snapshot.create"] = async (input) => {
      const parsed = KnowledgeMcpWorkspaceSnapshotCreateInputSchema.parse(input);
      const created = await workspaceSnapshots.create(
        await issueDurablePermission(parsed, "write"),
      );
      await authorizeAgentWorkspaceDerivedResult({
        access: durableAccess(),
        authorization: options.authorization.guard,
        callerKind: "mcp",
        requiredAccess: "write",
        snapshot: created,
        subject: options.authorization.subject,
      });
      return toMcpToolResult(toMcpPublicDerivedResult(toPublicAgentWorkspaceSnapshot(created)));
    };
    handlers["knowledge.workspace_snapshot.get"] = async (input) => {
      const parsed = KnowledgeMcpWorkspaceSnapshotGetInputSchema.parse(input);
      const existing = await workspaceSnapshots.get(parsed);
      if (!existing) {
        return toMcpToolResult({ error: "Not found" });
      }
      await authorizeAgentWorkspaceDerivedResult({
        access: durableAccess(),
        authorization: options.authorization.guard,
        callerKind: "mcp",
        requiredAccess: "read",
        snapshot: existing,
        subject: options.authorization.subject,
      });
      return toMcpToolResult(toMcpPublicDerivedResult(toPublicAgentWorkspaceSnapshot(existing)));
    };
    const replayWorkspaceSnapshot = workspaceSnapshots.replay;
    if (replayWorkspaceSnapshot) {
      handlers["knowledge.workspace_snapshot.replay"] = async (input) => {
        const parsed = KnowledgeMcpWorkspaceSnapshotReplayInputSchema.parse(input);
        const existing = await workspaceSnapshots.get({ id: parsed.id });
        if (!existing) {
          return toMcpToolResult({ error: "Not found" });
        }
        const durablePermission = await authorizeAgentWorkspaceDerivedResult({
          access: durableAccess(),
          authorization: options.authorization.guard,
          callerKind: "mcp",
          requiredAccess: "write",
          snapshot: existing,
          subject: options.authorization.subject,
        });
        const replay = await replayWorkspaceSnapshot({
          ...parsed,
          durablePermission: {
            accessChannel: durablePermission.accessChannel,
            id: durablePermission.id,
            revision: durablePermission.revision,
            subjectId: durablePermission.subjectId,
            tenantId: durablePermission.tenantId,
          },
          permissionScope: [...durablePermission.permissionScopes],
        });
        if (replay) {
          await authorizeAgentWorkspaceDerivedResult({
            access: durableAccess(),
            authorization: options.authorization.guard,
            callerKind: "mcp",
            requiredAccess: "write",
            snapshot: existing,
            subject: options.authorization.subject,
          });
        }
        return replay
          ? toMcpToolResult(toMcpPublicDerivedResult(toPublicAgentWorkspaceReplay(replay)))
          : toMcpToolResult({ error: "Not found" });
      };
    }
  }

  const callMcpHandler = async (name: KnowledgeMcpToolName, input: unknown) => {
    const handler = handlers[name];
    if (handler === undefined) {
      throw new Error(`MCP tool ${name} is not registered`);
    }
    return handler(input);
  };

  server.registerTool(
    "knowledge.fs.ls",
    {
      description: "List a bounded KnowledgeFS directory for a knowledge space.",
      inputSchema: KnowledgeMcpFsListInputSchema.shape,
      title: "KnowledgeFS List",
    },
    async (input) => callMcpHandler("knowledge.fs.ls", input),
  );
  server.registerTool(
    "knowledge.fs.tree",
    {
      description: "Read a bounded KnowledgeFS tree for a knowledge space.",
      inputSchema: KnowledgeMcpFsListInputSchema.shape,
      title: "KnowledgeFS Tree",
    },
    async (input) => callMcpHandler("knowledge.fs.tree", input),
  );
  server.registerTool(
    "knowledge.fs.cat",
    {
      description: "Read text content from a KnowledgeFS file path.",
      inputSchema: KnowledgeMcpFsCatInputSchema.shape,
      title: "KnowledgeFS Cat",
    },
    async (input) => callMcpHandler("knowledge.fs.cat", input),
  );
  server.registerTool(
    "knowledge.fs.grep",
    {
      description: "Search KnowledgeFS path text with bounded exact grep.",
      inputSchema: KnowledgeMcpFsGrepInputSchema.shape,
      title: "KnowledgeFS Grep",
    },
    async (input) => callMcpHandler("knowledge.fs.grep", input),
  );
  server.registerTool(
    "knowledge.fs.find",
    {
      description: "Find KnowledgeFS paths by bounded metadata and name filters.",
      inputSchema: KnowledgeMcpFsFindInputSchema.shape,
      title: "KnowledgeFS Find",
    },
    async (input) => callMcpHandler("knowledge.fs.find", input),
  );
  server.registerTool(
    "knowledge.fs.stat",
    {
      description: "Read KnowledgeFS path metadata.",
      inputSchema: KnowledgeMcpFsCatInputSchema.shape,
      title: "KnowledgeFS Stat",
    },
    async (input) => callMcpHandler("knowledge.fs.stat", input),
  );
  server.registerTool(
    "knowledge.fs.diff",
    {
      description: "Diff two KnowledgeFS text paths.",
      inputSchema: KnowledgeMcpFsDiffInputSchema.shape,
      title: "KnowledgeFS Diff",
    },
    async (input) => callMcpHandler("knowledge.fs.diff", input),
  );
  server.registerTool(
    "knowledge.fs.open_node",
    {
      description: "Open a KnowledgeFS node with citation source location.",
      inputSchema: KnowledgeMcpFsOpenNodeInputSchema.shape,
      title: "KnowledgeFS Open Node",
    },
    async (input) => callMcpHandler("knowledge.fs.open_node", input),
  );
  server.registerTool(
    "knowledge.search",
    {
      description: "Run bounded hybrid search in a knowledge space.",
      inputSchema: KnowledgeMcpSearchInputSchema.shape,
      title: "Knowledge Search",
    },
    async (input) => callMcpHandler("knowledge.search", input),
  );
  server.registerTool(
    "knowledge.fetch_evidence",
    {
      description: "Fetch a structured evidence bundle for a query.",
      inputSchema: KnowledgeMcpSearchInputSchema.shape,
      title: "Knowledge Fetch Evidence",
    },
    async (input) => callMcpHandler("knowledge.fetch_evidence", input),
  );
  if (options.documents) {
    server.registerTool(
      "knowledge.get_document_outline",
      {
        description:
          "Read a document outline with TOC, summaries, pages, offsets, and title locations.",
        inputSchema: KnowledgeMcpDocumentOutlineInputSchema.shape,
        title: "Knowledge Document Outline",
      },
      async (input) => callMcpHandler("knowledge.get_document_outline", input),
    );
  }
  server.registerTool(
    "knowledge.shell.plan",
    {
      description: "Plan an allowlisted safe shell command.",
      inputSchema: KnowledgeMcpShellInputSchema.shape,
      title: "Knowledge Shell Plan",
    },
    async (input) => callMcpHandler("knowledge.shell.plan", input),
  );
  server.registerTool(
    "knowledge.shell.execute",
    {
      description: "Execute an allowlisted safe shell command.",
      inputSchema: KnowledgeMcpShellInputSchema.shape,
      title: "Knowledge Shell Execute",
    },
    async (input) => callMcpHandler("knowledge.shell.execute", input),
  );
  if (options.operator) {
    server.registerTool(
      "knowledge.space.status",
      {
        description: "Read a bounded KnowledgeSpace operator status summary.",
        inputSchema: KnowledgeMcpSpaceStatusInputSchema.shape,
        title: "Knowledge Space Status",
      },
      async (input) => callMcpHandler("knowledge.space.status", input),
    );
    server.registerTool(
      "knowledge.fsck",
      {
        description: "Read bounded KnowledgeFS fsck diagnostics without repair actions.",
        inputSchema: KnowledgeMcpFsckInputSchema.shape,
        title: "Knowledge FSCK",
      },
      async (input) => callMcpHandler("knowledge.fsck", input),
    );
  }
  if (options.research) {
    server.registerTool(
      "knowledge.research.plan",
      {
        description: "Plan a bounded research task without enqueueing work.",
        inputSchema: KnowledgeMcpResearchPlanInputSchema.shape,
        title: "Knowledge Research Plan",
      },
      async (input) => {
        const handler = handlers["knowledge.research.plan"];
        if (!handler) {
          throw new Error("MCP tool knowledge.research.plan is not registered");
        }
        return handler(input);
      },
    );
    server.registerTool(
      "knowledge.research.create",
      {
        description: "Create a bounded research task job.",
        inputSchema: KnowledgeMcpResearchCreateInputSchema.shape,
        title: "Knowledge Research Create",
      },
      async (input) => {
        const handler = handlers["knowledge.research.create"];
        if (!handler) {
          throw new Error("MCP tool knowledge.research.create is not registered");
        }
        return handler(input);
      },
    );
    server.registerTool(
      "knowledge.research.get",
      {
        description: "Read a research task job.",
        inputSchema: KnowledgeMcpResearchJobInputSchema.shape,
        title: "Knowledge Research Get",
      },
      async (input) => {
        const handler = handlers["knowledge.research.get"];
        if (!handler) {
          throw new Error("MCP tool knowledge.research.get is not registered");
        }
        return handler(input);
      },
    );
    server.registerTool(
      "knowledge.research.cancel",
      {
        description: "Cancel a research task job.",
        inputSchema: KnowledgeMcpResearchJobInputSchema.shape,
        title: "Knowledge Research Cancel",
      },
      async (input) => {
        const handler = handlers["knowledge.research.cancel"];
        if (!handler) {
          throw new Error("MCP tool knowledge.research.cancel is not registered");
        }
        return handler(input);
      },
    );
  }
  if (options.workspaceSnapshots) {
    server.registerTool(
      "knowledge.workspace_snapshot.create",
      {
        description: "Create an agent workspace snapshot.",
        inputSchema: KnowledgeMcpWorkspaceSnapshotCreateInputSchema.shape,
        title: "Knowledge Workspace Snapshot Create",
      },
      async (input) => callMcpHandler("knowledge.workspace_snapshot.create", input),
    );
    server.registerTool(
      "knowledge.workspace_snapshot.get",
      {
        description: "Read an agent workspace snapshot.",
        inputSchema: KnowledgeMcpWorkspaceSnapshotGetInputSchema.shape,
        title: "Knowledge Workspace Snapshot Get",
      },
      async (input) => callMcpHandler("knowledge.workspace_snapshot.get", input),
    );
    if (options.workspaceSnapshots.replay) {
      server.registerTool(
        "knowledge.workspace_snapshot.replay",
        {
          description: "Replay a bounded agent workspace snapshot command log.",
          inputSchema: KnowledgeMcpWorkspaceSnapshotReplayInputSchema.shape,
          title: "Knowledge Workspace Snapshot Replay",
        },
        async (input) => callMcpHandler("knowledge.workspace_snapshot.replay", input),
      );
    }
  }

  return {
    callTool: async (name, input) => {
      const handler = handlers[name as KnowledgeMcpToolName];
      if (handler === undefined) {
        throw new Error(`MCP tool ${name} is not registered`);
      }
      return handler(input);
    },
    listTools: () =>
      [
        ...KNOWLEDGE_MCP_TOOLS,
        ...(options.documents ? KNOWLEDGE_MCP_DOCUMENT_TOOLS : []),
        ...(options.operator ? KNOWLEDGE_MCP_OPERATOR_TOOLS : []),
        ...(options.research ? KNOWLEDGE_MCP_RESEARCH_TOOLS : []),
        ...(options.workspaceSnapshots ? KNOWLEDGE_MCP_WORKSPACE_SNAPSHOT_TOOLS : []),
        ...(options.workspaceSnapshots?.replay ? KNOWLEDGE_MCP_WORKSPACE_REPLAY_TOOLS : []),
      ].map((tool) => ({ ...tool })),
    server,
  };
}
