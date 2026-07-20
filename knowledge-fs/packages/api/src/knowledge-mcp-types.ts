import type {
  AuthSubject,
  DocumentOutline,
  EvidenceBundle,
  KnowledgeFsckReport,
  KnowledgePath,
  ResourceMount,
} from "@knowledge/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type {
  AgentWorkspaceReplay,
  AgentWorkspaceSnapshot,
  AgentWorkspaceSnapshotCommand,
  AgentWorkspaceSnapshotSourceVersion,
} from "./agent-workspace-snapshot";
import type { AutoRetrievalModeResolver } from "./auto-retrieval-mode-resolver";
import type {
  KnowledgeFsCatResult,
  KnowledgeFsDiffResult,
  KnowledgeFsGrepResult,
  KnowledgeFsListResult,
  KnowledgeFsOpenNodeResult,
  KnowledgeFsStatResult,
  KnowledgeFsTreeResult,
} from "./knowledge-fs-types";
import type {
  KnowledgeSpaceAccessChannel,
  KnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import type { KnowledgeSpaceAuthorizationGuard } from "./knowledge-space-authorization";
import type {
  PublishedKnowledgeSpaceRuntimeSnapshot,
  PublishedKnowledgeSpaceRuntimeSnapshotResolver,
} from "./published-knowledge-space-runtime-snapshot";
import type { ResearchTaskJob, ResearchTaskJobLimits } from "./research-task-job";
import type {
  ResearchTaskDryRunPlan,
  ResearchTaskPlanMode,
  ResearchTaskResolvedMode,
} from "./research-task-planning";
import type { SafeShellExecutionResult, SafeShellPlan } from "./safe-shell";

export interface KnowledgeMcpPermissionContext {
  /** Server-issued grants; tool input schemas never accept this field from the model/client. */
  readonly permissionScope?: readonly string[] | undefined;
  /** Server-only durable ACL reference; tool input schemas never accept this field. */
  readonly durablePermission?:
    | {
        readonly accessChannel: KnowledgeSpaceAccessChannel;
        readonly id: string;
        readonly revision: number;
        readonly subjectId: string;
        readonly tenantId: string;
      }
    | undefined;
}

export type KnowledgeMcpToolName =
  | "knowledge.fetch_evidence"
  | "knowledge.get_document_outline"
  | "knowledge.fs.cat"
  | "knowledge.fs.diff"
  | "knowledge.fs.find"
  | "knowledge.fs.grep"
  | "knowledge.fs.ls"
  | "knowledge.fs.open_node"
  | "knowledge.fs.stat"
  | "knowledge.fs.tree"
  | "knowledge.research.cancel"
  | "knowledge.research.create"
  | "knowledge.research.get"
  | "knowledge.research.plan"
  | "knowledge.search"
  | "knowledge.shell.execute"
  | "knowledge.shell.plan"
  | "knowledge.space.status"
  | "knowledge.fsck"
  | "knowledge.workspace_snapshot.create"
  | "knowledge.workspace_snapshot.get"
  | "knowledge.workspace_snapshot.replay";

export interface KnowledgeMcpToolSummary {
  readonly description: string;
  readonly name: KnowledgeMcpToolName;
}

export interface KnowledgeMcpFsListInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly depth?: number | undefined;
  readonly limit: number;
  readonly path: string;
  readonly snapshotFingerprint?: string | undefined;
}

export interface KnowledgeMcpFsCatInput {
  readonly knowledgeSpaceId: string;
  readonly path: string;
  readonly snapshotFingerprint?: string | undefined;
}

export interface KnowledgeMcpFsGrepInput extends KnowledgeMcpFsListInput {
  readonly q: string;
}

export interface KnowledgeMcpFsFindInput extends KnowledgeMcpFsListInput {
  readonly metadataKey?: string | undefined;
  readonly metadataValue?: string | undefined;
  readonly nameContains?: string | undefined;
  readonly resourceType?: KnowledgePath["resourceType"] | undefined;
}

export interface KnowledgeMcpFsDiffInput {
  readonly knowledgeSpaceId: string;
  readonly mode?: "line" | "word" | undefined;
  readonly newPath: string;
  readonly oldPath: string;
  readonly snapshotFingerprint?: string | undefined;
}

export interface KnowledgeMcpFsOpenNodeInput {
  readonly knowledgeSpaceId: string;
  readonly nodeId: string;
  readonly snapshotFingerprint?: string | undefined;
}

export interface KnowledgeMcpSearchInput {
  readonly knowledgeSpaceId: string;
  readonly mode?: "auto" | "deep" | "fast" | "research" | undefined;
  readonly query: string;
  /** Server-frozen tuple used for an Auto decision; never accepted from MCP tool input. */
  readonly runtimeSnapshot?: PublishedKnowledgeSpaceRuntimeSnapshot | undefined;
  readonly snapshotFingerprint?: string | undefined;
  readonly topK: number;
}

export interface KnowledgeMcpDocumentOutlineInput {
  readonly documentId: string;
  readonly knowledgeSpaceId: string;
}

export interface KnowledgeMcpSearchResult {
  readonly items: readonly unknown[];
}

export interface KnowledgeMcpFetchEvidenceInput extends KnowledgeMcpSearchInput {}

export interface KnowledgeMcpShellInput {
  readonly command: string;
  readonly knowledgeSpaceId: string;
  readonly snapshotFingerprint?: string | undefined;
}

export interface KnowledgeMcpSpaceStatusInput {
  readonly knowledgeSpaceId: string;
}

export interface KnowledgeMcpFsckInput {
  readonly check?: "artifact-segments" | "raw-objects" | "references" | undefined;
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
}

export interface KnowledgeMcpResearchPlanInput {
  readonly budgetUsd?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly mode?: ResearchTaskPlanMode | undefined;
  readonly query: string;
  /** Server-resolved Auto decision; never accepted from MCP tool input. */
  readonly resolvedMode?: ResearchTaskResolvedMode | undefined;
  /** Server-frozen tuple used for an Auto decision; never accepted from MCP tool input. */
  readonly runtimeSnapshot?: PublishedKnowledgeSpaceRuntimeSnapshot | undefined;
  readonly topK?: number | undefined;
}

export interface KnowledgeMcpResearchCreateInput extends KnowledgeMcpResearchPlanInput {
  readonly limits?: ResearchTaskJobLimits | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface KnowledgeMcpResearchJobInput {
  readonly id: string;
}

export interface KnowledgeMcpWorkspaceSnapshotCreateInput {
  readonly commandLog: readonly AgentWorkspaceSnapshotCommand[];
  readonly evidenceBundles: readonly EvidenceBundle[];
  readonly indexProjection: AgentWorkspaceSnapshot["indexProjection"];
  readonly knowledgeSpaceId: string;
  readonly manifestVersion?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly mounts: readonly ResourceMount[];
  readonly pathVersions?: AgentWorkspaceSnapshot["pathVersions"] | undefined;
  readonly researchTaskJobId?: string | undefined;
  readonly sourceVersions: readonly AgentWorkspaceSnapshotSourceVersion[];
  readonly traceIds: readonly string[];
}

export interface KnowledgeMcpWorkspaceSnapshotGetInput {
  readonly id: string;
}

export interface KnowledgeMcpWorkspaceSnapshotReplayInput {
  readonly id: string;
  readonly snapshotFingerprint?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface KnowledgeMcpServerOptions {
  readonly autoRetrievalModeResolver?: AutoRetrievalModeResolver | undefined;
  /** Required at every MCP boundary; caller kind is fixed to `mcp`. */
  readonly authorization: {
    /** Required when durable Research or Workspace tools are registered. */
    readonly access?:
      | Pick<
          KnowledgeSpaceAccessService,
          "createPermissionSnapshot" | "revalidatePermissionSnapshot"
        >
      | undefined;
    readonly guard: KnowledgeSpaceAuthorizationGuard;
    readonly now?: (() => number) | undefined;
    readonly permissionSnapshotTtlMs?: number | undefined;
    readonly subject: AuthSubject;
  };
  readonly documents?:
    | {
        getOutline(
          input: KnowledgeMcpDocumentOutlineInput & KnowledgeMcpPermissionContext,
        ): DocumentOutline | null | Promise<DocumentOutline | null>;
      }
    | undefined;
  readonly fetchEvidence: (
    input: KnowledgeMcpFetchEvidenceInput & KnowledgeMcpPermissionContext,
  ) => EvidenceBundle | Promise<EvidenceBundle>;
  readonly fs: {
    cat(
      input: KnowledgeMcpFsCatInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsCatResult | Promise<KnowledgeFsCatResult>;
    diff(
      input: KnowledgeMcpFsDiffInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsDiffResult | Promise<KnowledgeFsDiffResult>;
    find(
      input: KnowledgeMcpFsFindInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsListResult | Promise<KnowledgeFsListResult>;
    grep(
      input: KnowledgeMcpFsGrepInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsGrepResult | Promise<KnowledgeFsGrepResult>;
    ls(
      input: KnowledgeMcpFsListInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsListResult | Promise<KnowledgeFsListResult>;
    openNode(
      input: KnowledgeMcpFsOpenNodeInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsOpenNodeResult | Promise<KnowledgeFsOpenNodeResult>;
    stat(
      input: KnowledgeMcpFsCatInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsStatResult | Promise<KnowledgeFsStatResult>;
    tree(
      input: KnowledgeMcpFsListInput & KnowledgeMcpPermissionContext,
    ): KnowledgeFsTreeResult | Promise<KnowledgeFsTreeResult>;
  };
  readonly maxFsListLimit?: number | undefined;
  readonly maxOperatorIssues?: number | undefined;
  readonly maxResearchTopK?: number | undefined;
  readonly maxSearchTopK?: number | undefined;
  readonly research?:
    | {
        cancel(
          input: KnowledgeMcpResearchJobInput,
        ): ResearchTaskJob | null | Promise<ResearchTaskJob | null>;
        create(
          input: KnowledgeMcpResearchCreateInput & KnowledgeMcpPermissionContext,
        ): ResearchTaskJob | Promise<ResearchTaskJob>;
        get(
          input: KnowledgeMcpResearchJobInput,
        ): ResearchTaskJob | null | Promise<ResearchTaskJob | null>;
        plan(
          input: KnowledgeMcpResearchPlanInput & KnowledgeMcpPermissionContext,
        ): ResearchTaskDryRunPlan | Promise<ResearchTaskDryRunPlan>;
      }
    | undefined;
  /** Freezes the publication and model-profile tuple before any durable Research create call. */
  readonly runtimeSnapshotResolver?: PublishedKnowledgeSpaceRuntimeSnapshotResolver | undefined;
  readonly operator?:
    | {
        fsck(
          input: KnowledgeMcpFsckInput & KnowledgeMcpPermissionContext,
        ): KnowledgeFsckReport | Promise<KnowledgeFsckReport>;
        status(
          input: KnowledgeMcpSpaceStatusInput & KnowledgeMcpPermissionContext,
        ): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>;
      }
    | undefined;
  readonly search: (
    input: KnowledgeMcpSearchInput & KnowledgeMcpPermissionContext,
  ) => KnowledgeMcpSearchResult | Promise<KnowledgeMcpSearchResult>;
  readonly shell: {
    execute(
      input: KnowledgeMcpShellInput & KnowledgeMcpPermissionContext,
    ): SafeShellExecutionResult | Promise<SafeShellExecutionResult>;
    plan(
      input: KnowledgeMcpShellInput & KnowledgeMcpPermissionContext,
    ): SafeShellPlan | Promise<SafeShellPlan>;
  };
  readonly workspaceSnapshots?:
    | {
        create(
          input: KnowledgeMcpWorkspaceSnapshotCreateInput & KnowledgeMcpPermissionContext,
        ): AgentWorkspaceSnapshot | Promise<AgentWorkspaceSnapshot>;
        get(
          input: KnowledgeMcpWorkspaceSnapshotGetInput,
        ): AgentWorkspaceSnapshot | null | Promise<AgentWorkspaceSnapshot | null>;
        replay?: (
          input: KnowledgeMcpWorkspaceSnapshotReplayInput & KnowledgeMcpPermissionContext,
        ) => AgentWorkspaceReplay | null | Promise<AgentWorkspaceReplay | null>;
      }
    | undefined;
}

export interface KnowledgeMcpServer {
  callTool(name: string, input: unknown): Promise<CallToolResult>;
  listTools(): KnowledgeMcpToolSummary[];
  readonly server: McpServer;
}

export const KNOWLEDGE_MCP_TOOLS: readonly KnowledgeMcpToolSummary[] = [
  {
    description: "List a bounded KnowledgeFS directory for a knowledge space.",
    name: "knowledge.fs.ls",
  },
  {
    description: "Read a bounded KnowledgeFS tree for a knowledge space.",
    name: "knowledge.fs.tree",
  },
  {
    description: "Read text content from a KnowledgeFS file path.",
    name: "knowledge.fs.cat",
  },
  {
    description: "Search KnowledgeFS path text with bounded exact grep.",
    name: "knowledge.fs.grep",
  },
  {
    description: "Find KnowledgeFS paths by bounded metadata and name filters.",
    name: "knowledge.fs.find",
  },
  {
    description: "Read KnowledgeFS path metadata.",
    name: "knowledge.fs.stat",
  },
  {
    description: "Diff two KnowledgeFS text paths.",
    name: "knowledge.fs.diff",
  },
  {
    description: "Open a KnowledgeFS node with citation source location.",
    name: "knowledge.fs.open_node",
  },
  {
    description: "Run bounded hybrid search in a knowledge space.",
    name: "knowledge.search",
  },
  {
    description: "Fetch a structured evidence bundle for a query.",
    name: "knowledge.fetch_evidence",
  },
  {
    description: "Plan an allowlisted safe shell command.",
    name: "knowledge.shell.plan",
  },
  {
    description: "Execute an allowlisted safe shell command.",
    name: "knowledge.shell.execute",
  },
];

export const KNOWLEDGE_MCP_DOCUMENT_TOOLS: readonly KnowledgeMcpToolSummary[] = [
  {
    description:
      "Read a document outline with TOC, summaries, pages, offsets, and title locations.",
    name: "knowledge.get_document_outline",
  },
];

export const KNOWLEDGE_MCP_RESEARCH_TOOLS: readonly KnowledgeMcpToolSummary[] = [
  {
    description: "Plan a bounded research task without enqueueing work.",
    name: "knowledge.research.plan",
  },
  {
    description: "Create a bounded research task job.",
    name: "knowledge.research.create",
  },
  {
    description: "Read a research task job.",
    name: "knowledge.research.get",
  },
  {
    description: "Cancel a research task job.",
    name: "knowledge.research.cancel",
  },
];

export const KNOWLEDGE_MCP_OPERATOR_TOOLS: readonly KnowledgeMcpToolSummary[] = [
  {
    description: "Read a bounded KnowledgeSpace operator status summary.",
    name: "knowledge.space.status",
  },
  {
    description: "Read bounded KnowledgeFS fsck diagnostics without repair actions.",
    name: "knowledge.fsck",
  },
];

export const KNOWLEDGE_MCP_WORKSPACE_SNAPSHOT_TOOLS: readonly KnowledgeMcpToolSummary[] = [
  {
    description: "Create an agent workspace snapshot.",
    name: "knowledge.workspace_snapshot.create",
  },
  {
    description: "Read an agent workspace snapshot.",
    name: "knowledge.workspace_snapshot.get",
  },
];

export const KNOWLEDGE_MCP_WORKSPACE_REPLAY_TOOLS: readonly KnowledgeMcpToolSummary[] = [
  {
    description: "Replay a bounded agent workspace snapshot command log.",
    name: "knowledge.workspace_snapshot.replay",
  },
];
