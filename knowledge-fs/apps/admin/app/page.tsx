import React from "react";

import {
  type AdminAnswerTrace,
  type AdminApiClient,
  type AdminDocumentAsset,
  type AdminGoldenQuestionList,
  type AdminGraphTraversal,
  type AdminHealthStatus,
  type AdminKnowledgeFsCat,
  type AdminKnowledgeFsDiff,
  type AdminKnowledgeFsEntry,
  type AdminKnowledgeFsGcDryRunReport,
  type AdminKnowledgeFsGrep,
  type AdminKnowledgeFsLeaseList,
  type AdminKnowledgeFsList,
  type AdminKnowledgeFsOpenNode,
  type AdminKnowledgeFsStat,
  type AdminKnowledgeFsTree,
  type AdminKnowledgeFsTreeNode,
  type AdminKnowledgeFsWrite,
  type AdminKnowledgeFsckReport,
  type AdminKnowledgeSpace,
  type AdminKnowledgeSpaceManifest,
  type AdminKnowledgeSpaceStagedCommitList,
  type AdminKnowledgeSpaceStatus,
  type AdminParseArtifact,
  createAdminApiClient,
  getAdminApiBase,
  getAdminPublicApiBase,
} from "../lib/api-client";
import { formatBytes } from "../lib/display-format";
import { createDocumentHealthReport } from "../lib/document-health";
import { adminRowKey, graphEntityRowKey, graphRelationRowKey } from "../lib/graph-row-keys";
import { getAdminServerToken } from "../lib/server-auth";
import { createTraceComparison } from "../lib/trace-comparison";
import { createTraceSummary } from "../lib/trace-summary";
import { type NavEntry, SidebarNav } from "./components/sidebar-nav";

export const dynamic = "force-dynamic";

const fallbackWorkspaceOption = {
  id: "workspace",
  name: "workspace",
  slug: "workspace",
} as const;

const defaultKnowledgeFsPath = "/knowledge/docs";
const knowledgeFsCommands = [
  "ls",
  "tree",
  "cat",
  "stat",
  "grep",
  "find",
  "diff",
  "open_node",
  "write",
  "append",
] as const;

interface AdminWorkspaceOption {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

type AdminKnowledgeFsCommand = (typeof knowledgeFsCommands)[number];

interface AdminKnowledgeFsCommandState {
  readonly command: AdminKnowledgeFsCommand;
  readonly depth: string;
  readonly error?: string | undefined;
  readonly findMetadataKey: string;
  readonly findMetadataValue: string;
  readonly findNameContains: string;
  readonly findResourceType: string;
  readonly grepQuery: string;
  readonly limit: string;
  readonly nodeId: string;
  readonly writeText: string;
  readonly result?:
    | AdminKnowledgeFsCat
    | AdminKnowledgeFsDiff
    | AdminKnowledgeFsGrep
    | AdminKnowledgeFsList
    | AdminKnowledgeFsOpenNode
    | AdminKnowledgeFsStat
    | AdminKnowledgeFsTree
    | AdminKnowledgeFsWrite
    | undefined;
}

interface AdminHomeProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface AdminHomeViewProps {
  readonly healthItems: readonly AdminHealthMetric[];
  readonly liveData: AdminLiveData;
  readonly notice?: AdminNotice | undefined;
  readonly queryResult?: AdminQueryResult | null | undefined;
  readonly uploadResult?: AdminUploadResult | null | undefined;
  readonly workspaceOptions: readonly AdminWorkspaceOption[];
}

interface AdminHealthMetric {
  readonly badge: string;
  readonly label: string;
  readonly status: "fail" | "ok" | "warn";
  readonly value: string;
}

interface AdminPublishReadiness {
  readonly badge: string;
  readonly elementCount: string;
  readonly fileSize: string;
  readonly nodeCount: string;
  readonly parserStatus: string;
  readonly qualityRisks: string;
  readonly status: "fail" | "ready" | "review" | "warn";
  readonly subtitle: string;
}

interface AdminLiveData {
  readonly activeWorkspace: AdminWorkspaceOption;
  readonly activeLeases?: AdminKnowledgeFsLeaseList | undefined;
  readonly compareTrace?: AdminAnswerTrace | undefined;
  readonly communityView?: AdminKnowledgeFsList | undefined;
  readonly diff?: AdminKnowledgeFsDiff | undefined;
  readonly entityId: string;
  readonly entityView?: AdminKnowledgeFsList | undefined;
  readonly errors: readonly string[];
  readonly failedCommits?: AdminKnowledgeSpaceStagedCommitList | undefined;
  readonly fsCommand: AdminKnowledgeFsCommandState;
  readonly fsck?: AdminKnowledgeFsckReport | undefined;
  readonly gcDryRun?: AdminKnowledgeFsGcDryRunReport | undefined;
  readonly fsPath: string;
  readonly graph?: AdminGraphTraversal | undefined;
  readonly goldenQuestions?: AdminGoldenQuestionList | undefined;
  readonly manifest?: AdminKnowledgeSpaceManifest | undefined;
  readonly newPath: string;
  readonly oldPath: string;
  readonly publishReadiness?: AdminPublishReadiness | undefined;
  readonly queryConflicts?: AdminKnowledgeFsList | undefined;
  readonly queryEvidence?: AdminKnowledgeFsList | undefined;
  readonly queryMissing?: AdminKnowledgeFsList | undefined;
  readonly rootFs?: AdminKnowledgeFsList | undefined;
  readonly status?: AdminKnowledgeSpaceStatus | undefined;
  readonly topicView?: AdminKnowledgeFsList | undefined;
  readonly trace?: AdminAnswerTrace | undefined;
}

interface AdminNotice {
  readonly message: string;
  readonly status: "error" | "success";
}

type AdminUploadResult =
  | {
      readonly documentId: string;
      readonly filename: string;
      readonly parserStatus: "failed" | "parsed" | "pending";
      readonly sha256: string;
      readonly sizeBytes: number;
      readonly spaceId: string;
      readonly status: "success";
      readonly version: number;
    }
  | {
      readonly error: string;
      readonly status: "error";
    };

type AdminQueryResult =
  | {
      readonly answer: string;
      readonly citations: readonly string[];
      readonly confidence: string;
      readonly freshness: string;
      readonly query: string;
      readonly status: "success";
      readonly traceId?: string | undefined;
    }
  | {
      readonly error: string;
      readonly status: "error";
    };

interface Loaded<T> {
  readonly error?: string | undefined;
  readonly value?: T | undefined;
}

export default async function AdminHome({ searchParams }: AdminHomeProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const [workspaceOptions, health] = await Promise.all([
    loadAdminWorkspaceOptions(),
    loadAdminHealth(),
  ]);
  const uploadResult = parseUploadResult(resolvedSearchParams);
  const queryResult = parseQueryResult(resolvedSearchParams);
  const liveData = await loadAdminLiveData({
    queryResult,
    searchParams: resolvedSearchParams,
    uploadResult,
    workspaceOptions,
  });

  return (
    <AdminHomeView
      healthItems={createHealthItems(health)}
      liveData={liveData}
      notice={parseAdminNotice(resolvedSearchParams)}
      queryResult={queryResult}
      uploadResult={uploadResult}
      workspaceOptions={workspaceOptions}
    />
  );
}

function AdminHomeView({
  healthItems,
  liveData,
  notice,
  queryResult = null,
  uploadResult = null,
  workspaceOptions,
}: AdminHomeViewProps) {
  const apiBase = getAdminPublicApiBase();
  const resolvedWorkspaceOptions =
    workspaceOptions.length > 0 ? workspaceOptions : [fallbackWorkspaceOption];
  const activeWorkspaceId = liveData.activeWorkspace.id;
  const retrievalResult = createRetrievalResult(queryResult);
  const publishReadiness = liveData.publishReadiness ?? createPublishReadiness(uploadResult);
  const evaluationStats = createEvaluationStats(liveData.goldenQuestions);
  const semanticViewStatus = createSemanticViewStatus(liveData);

  return (
    <main className="admin-shell">
      <aside className="sidebar" aria-label="Admin navigation">
        <div className="brand">
          <strong>KnowledgeFS Admin</strong>
          <span>Standalone console</span>
        </div>
        <SidebarNav
          items={
            [
              { label: "System health", href: "#health" },
              { label: "Control plane", href: "#control-plane" },
              { label: "FSCK", href: "#fsck" },
              { label: "GC", href: "#gc-staged-objects" },
              { label: "Upload intake", href: "#upload" },
              { label: "Retrieval workspace", href: "#retrieval" },
              { label: "KnowledgeFS", href: "#knowledge-fs" },
              { label: "Documents", href: `/documents/${encodeURIComponent(activeWorkspaceId)}` },
              { label: "Entity browser", href: "#entities" },
              { label: "Semantic views", href: "#semantic-views" },
              { label: "Document diff", href: "#document-diff" },
              { label: "Golden questions", href: "#golden-questions" },
              { label: "Evaluation dashboard", href: "#evaluation-dashboard" },
              { label: "Retrieval Studio", href: "#retrieval-studio" },
              { label: "Trace comparison", href: "#trace-comparison" },
              { label: "Failed diagnostics", href: "#failed-query-diagnostics" },
              { label: "Trace review", href: "#trace" },
            ] satisfies NavEntry[]
          }
        />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>KnowledgeFS Admin</h1>
            <p>Operational console for ingestion, retrieval, traces, and readiness.</p>
          </div>
          <div className="api-base" aria-label="API base">
            <span>API base</span>
            <code>{apiBase}</code>
          </div>
        </header>

        {notice ? (
          <section className={`result-card ${notice.status === "error" ? "fail" : ""}`}>
            <div className="panel-header">
              <div>
                <h3>
                  {notice.status === "success" ? "Admin action complete" : "Admin action failed"}
                </h3>
                <small>{notice.message}</small>
              </div>
              <span className={`badge ${notice.status === "success" ? "ok" : "fail"}`}>
                {notice.status}
              </span>
            </div>
          </section>
        ) : null}

        {liveData.errors.length > 0 ? (
          <section className="result-card fail" aria-label="Admin data load warnings">
            <div className="panel-header">
              <div>
                <h3>Some live Admin data could not be loaded</h3>
                <small>{liveData.errors.slice(0, 3).join("; ")}</small>
              </div>
              <span className="badge warn">partial</span>
            </div>
          </section>
        ) : null}

        <section id="health" className="grid health-grid" aria-label="System health">
          {healthItems.map((item) => (
            <article className="metric" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <em className={`badge ${item.status}`}>{item.badge}</em>
            </article>
          ))}
        </section>

        <section className="grid work-grid" aria-label="Admin work areas">
          <article id="control-plane" className="panel">
            <div className="panel-header">
              <div>
                <h2>Control plane</h2>
                <small>{liveData.activeWorkspace.name}</small>
              </div>
              <span className={`badge ${liveData.manifest && liveData.status ? "ok" : "warn"}`}>
                {liveData.manifest && liveData.status ? "Live" : "Unavailable"}
              </span>
            </div>
            <div className="status-list">
              <StatusRow
                label="Manifest version"
                value={String(liveData.manifest?.manifestVersion ?? "Unavailable")}
              />
              <StatusRow
                label="Storage provider"
                value={liveData.manifest?.storageProvider ?? "Unavailable"}
              />
              <StatusRow
                label="Object prefix"
                value={liveData.manifest?.objectKeyPrefix ?? "Unavailable"}
              />
              <StatusRow
                label="Parser policy"
                value={liveData.manifest?.parserPolicyVersion ?? "Unavailable"}
              />
              <StatusRow
                label="Projection set"
                value={liveData.manifest?.projectionSetVersion ?? "Unavailable"}
              />
              <StatusRow
                label="Raw bytes"
                value={formatStatusNumber(liveData.status?.storage, "rawDocumentBytes")}
              />
              <StatusRow
                label="Documents"
                value={formatStatusNumber(liveData.status?.storage, "documentCount")}
              />
              <StatusRow
                label="Active sessions"
                value={formatStatusNumber(liveData.status?.runtime, "activeSessionCount")}
              />
            </div>
          </article>

          <article id="operations-diagnostics" className="panel">
            <div className="panel-header">
              <div>
                <h2>Operations diagnostics</h2>
                <small>Failed commits and active leases</small>
              </div>
              <span
                className={`badge ${liveData.failedCommits && liveData.activeLeases ? "ok" : "warn"}`}
              >
                {liveData.failedCommits && liveData.activeLeases ? "Live" : "Unavailable"}
              </span>
            </div>
            <div className="status-list">
              <StatusRow
                label="Failed commits"
                value={String(liveData.failedCommits?.items.length ?? "Unavailable")}
              />
              <StatusRow
                label="Active leases"
                value={String(liveData.activeLeases?.items.length ?? "Unavailable")}
              />
              <StatusRow
                label="Commit cursor"
                value={liveData.failedCommits?.nextCursor ? "More available" : "Current page"}
              />
              <StatusRow
                label="Lease cursor"
                value={liveData.activeLeases?.nextCursor ? "More available" : "Current page"}
              />
            </div>
            <div className="list-panel">
              {(liveData.failedCommits?.items ?? []).slice(0, 5).map((commit, index) => (
                <div className="list-row" key={adminRowKey("failed-commit", commit.id, index)}>
                  <strong>{commit.status}</strong>
                  <span>{commit.errorCode ?? commit.operationType}</span>
                  <code>{shortId(commit.id)}</code>
                </div>
              ))}
              {(liveData.activeLeases?.items ?? []).slice(0, 5).map((lease, index) => (
                <div className="list-row" key={adminRowKey("active-lease", lease.id, index)}>
                  <strong>{lease.leaseType}</strong>
                  <span>{lease.virtualPath}</span>
                  <code>{shortId(lease.id)}</code>
                </div>
              ))}
              {(liveData.failedCommits?.items.length ?? 0) === 0 &&
              (liveData.activeLeases?.items.length ?? 0) === 0 ? (
                <p className="empty-state">No active diagnostics</p>
              ) : null}
            </div>
          </article>

          <article id="fsck" className="panel">
            <div className="panel-header">
              <div>
                <h2>FSCK dry run</h2>
                <small>Raw object consistency check</small>
              </div>
              <span className={`badge ${liveData.fsck ? "ok" : "warn"}`}>
                {liveData.fsck ? "Read only" : "Unavailable"}
              </span>
            </div>
            <div className="status-list">
              <StatusRow label="Scanned" value={formatFsckSummary(liveData.fsck, "scanned")} />
              <StatusRow label="Errors" value={formatFsckSummary(liveData.fsck, "error")} />
              <StatusRow label="Warnings" value={formatFsckSummary(liveData.fsck, "warning")} />
              <StatusRow
                label="Repairable"
                value={formatFsckSummary(liveData.fsck, "repairable")}
              />
              <StatusRow
                label="Cursor"
                value={liveData.fsck?.cursor ? "More available" : "Current page"}
              />
            </div>
            <div className="list-panel">
              {(liveData.fsck?.issues ?? []).slice(0, 5).map((issue, index) => (
                <div className="list-row" key={fsckIssueKey(issue, index)}>
                  <strong>{issue.severity}</strong>
                  <span>{issue.message}</span>
                  <code>{issue.type}</code>
                </div>
              ))}
              {(liveData.fsck?.issues.length ?? 0) === 0 ? (
                <p className="empty-state">No fsck issues</p>
              ) : null}
            </div>
          </article>

          <article id="gc-staged-objects" className="panel">
            <div className="panel-header">
              <div>
                <h2>Staged object GC</h2>
                <small>Dry-run candidates</small>
              </div>
              <span className={`badge ${liveData.gcDryRun ? "warn" : "fail"}`}>
                {liveData.gcDryRun ? "Dry run" : "Unavailable"}
              </span>
            </div>
            <div className="status-list">
              <StatusRow
                label="Candidates"
                value={formatGcSummary(liveData.gcDryRun, "candidateCount")}
              />
              <StatusRow
                label="Estimated bytes"
                value={formatGcSummary(liveData.gcDryRun, "estimatedBytes")}
              />
              <StatusRow
                label="Dry-run id"
                value={liveData.gcDryRun?.dryRunId ?? "Unavailable"}
                mono
              />
              <StatusRow
                label="Cursor"
                value={liveData.gcDryRun?.cursor ? "More available" : "Current page"}
              />
            </div>
            <div className="list-panel">
              {(liveData.gcDryRun?.candidates ?? []).slice(0, 3).map((candidate) => (
                <form
                  action="/api/admin-gc-staged-object"
                  className="list-row"
                  key={candidate.idempotencyKey}
                  method="post"
                >
                  <input type="hidden" name="knowledgeSpaceId" value={activeWorkspaceId} />
                  <input type="hidden" name="dryRunId" value={liveData.gcDryRun?.dryRunId ?? ""} />
                  <input type="hidden" name="idempotencyKey" value={candidate.idempotencyKey} />
                  <input type="hidden" name="candidateJson" value={JSON.stringify(candidate)} />
                  <strong>{candidate.candidateType}</strong>
                  <span>{candidate.reason}</span>
                  <code>{shortId(candidate.idempotencyKey)}</code>
                  <button className="button secondary" type="submit">
                    Delete candidate
                  </button>
                </form>
              ))}
              {(liveData.gcDryRun?.candidates.length ?? 0) === 0 ? (
                <p className="empty-state">No GC candidates</p>
              ) : null}
            </div>
          </article>

          <article id="upload" className="panel">
            <div className="panel-header">
              <div>
                <h2>Upload intake</h2>
                <small>Single document ingestion</small>
              </div>
              <span className="badge ok">Ready</span>
            </div>
            <form
              action="/api/admin-upload"
              className="form-grid"
              encType="multipart/form-data"
              method="post"
            >
              <div className="field">
                <label htmlFor="space">Knowledge space</label>
                <select id="space" name="knowledgeSpaceId" defaultValue={activeWorkspaceId}>
                  {resolvedWorkspaceOptions.map((workspace, index) => (
                    <option
                      key={adminRowKey("workspace-option", workspace.id, index)}
                      value={workspace.id}
                    >
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="source">Source id</label>
                <input id="source" name="sourceId" />
              </div>
              <div className="field">
                <label htmlFor="file">Document</label>
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept=".md,.html,.pdf,.docx,.pptx,text/*"
                />
              </div>
              <div className="button-row">
                <button className="button" type="submit">
                  Upload document
                </button>
              </div>
            </form>
            <div className="button-row">
              <a className="button secondary" href="/api/bff/health">
                Check parser
              </a>
            </div>
            {uploadResult ? <UploadResultCard result={uploadResult} /> : null}
          </article>

          <article className="panel">
            <div className="panel-header">
              <div>
                <h2>Publish readiness</h2>
                <small>{publishReadiness.subtitle}</small>
              </div>
              <span className={`badge ${publishReadiness.status}`}>{publishReadiness.badge}</span>
            </div>
            <div className="status-list">
              <StatusRow label="Parser status" value={publishReadiness.parserStatus} />
              <StatusRow label="Node count" value={publishReadiness.nodeCount} />
              <StatusRow label="Quality risks" value={publishReadiness.qualityRisks} />
              <StatusRow label="Parse elements" value={publishReadiness.elementCount} />
              <StatusRow label="File size" value={publishReadiness.fileSize} />
            </div>
          </article>
        </section>

        <section className="grid work-grid" aria-label="Retrieval, entities, and traces">
          <article id="retrieval" className="panel">
            <div className="panel-header">
              <div>
                <h2>Retrieval workspace</h2>
                <small>{retrievalResult.subtitle}</small>
              </div>
              <span className="badge ok">Hybrid</span>
            </div>
            <form className="form-grid" action="/api/admin-query" method="post">
              <input type="hidden" value={activeWorkspaceId} name="knowledgeSpaceId" />
              <div className="field">
                <label htmlFor="query">Query</label>
                <input id="query" name="query" defaultValue={retrievalResult.query} />
              </div>
              <div className="field">
                <label htmlFor="mode">Mode</label>
                <select id="mode" name="mode" defaultValue="fast">
                  <option value="fast">fast</option>
                  <option value="deep">deep</option>
                  <option value="research">research</option>
                </select>
              </div>
              <div className="button-row">
                <button className="button" type="submit">
                  Run query
                </button>
                {retrievalResult.traceId ? (
                  <a
                    className="button secondary"
                    href={`/api/bff/queries/${encodeURIComponent(retrievalResult.traceId)}`}
                  >
                    Open citations
                  </a>
                ) : (
                  <button className="button secondary" type="button">
                    Open citations
                  </button>
                )}
              </div>
            </form>
            {queryResult?.status === "error" ? (
              <section className="result-card fail" aria-label="Query failed" aria-live="polite">
                <div className="panel-header">
                  <div>
                    <h3>Query failed</h3>
                    <small>{queryResult.error}</small>
                  </div>
                  <span className="badge fail">failed</span>
                </div>
              </section>
            ) : null}
            <div className="answer-preview" aria-label="Streaming answer">
              <h3>Streaming answer</h3>
              <p>{retrievalResult.answer}</p>
              <div className="status-list">
                <StatusRow label="Inline citations" value={retrievalResult.citations} />
                <StatusRow label="Confidence" value={retrievalResult.confidence} />
                <StatusRow label="Freshness" value={retrievalResult.freshness} />
                {retrievalResult.traceId ? (
                  <StatusRow label="Trace ID" value={retrievalResult.traceId} mono />
                ) : null}
                <StatusRow label="Knowledge space" value={activeWorkspaceId} mono />
              </div>
            </div>
          </article>

          <article id="knowledge-fs" className="panel">
            <div className="panel-header">
              <div>
                <h2>KnowledgeFS</h2>
                <small>Live virtual filesystem listing</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            <form className="form-grid" action="/" method="get">
              <input type="hidden" name="spaceId" value={activeWorkspaceId} />
              <div className="field">
                <label htmlFor="fsCommand">Command</label>
                <select id="fsCommand" name="fsCommand" defaultValue={liveData.fsCommand.command}>
                  {knowledgeFsCommands.map((command) => (
                    <option key={command} value={command}>
                      {command}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="fsPath">Path</label>
                <input id="fsPath" name="fsPath" defaultValue={liveData.fsPath} />
              </div>
              <div className="field span-2">
                <label htmlFor="fsWriteText">Write text</label>
                <textarea
                  id="fsWriteText"
                  name="fsWriteText"
                  defaultValue={liveData.fsCommand.writeText}
                />
              </div>
              <div className="field">
                <label htmlFor="fsLimit">Limit</label>
                <input id="fsLimit" name="fsLimit" defaultValue={liveData.fsCommand.limit} />
              </div>
              <div className="field">
                <label htmlFor="fsDepth">Depth</label>
                <input id="fsDepth" name="fsDepth" defaultValue={liveData.fsCommand.depth} />
              </div>
              <div className="field">
                <label htmlFor="fsGrepQuery">Grep query</label>
                <input
                  id="fsGrepQuery"
                  name="fsGrepQuery"
                  defaultValue={liveData.fsCommand.grepQuery}
                />
              </div>
              <div className="field">
                <label htmlFor="fsFindNameContains">Find name contains</label>
                <input
                  id="fsFindNameContains"
                  name="fsFindNameContains"
                  defaultValue={liveData.fsCommand.findNameContains}
                />
              </div>
              <div className="field">
                <label htmlFor="fsFindResourceType">Find resource type</label>
                <input
                  id="fsFindResourceType"
                  name="fsFindResourceType"
                  defaultValue={liveData.fsCommand.findResourceType}
                />
              </div>
              <div className="field">
                <label htmlFor="fsFindMetadataKey">Find metadata key</label>
                <input
                  id="fsFindMetadataKey"
                  name="fsFindMetadataKey"
                  defaultValue={liveData.fsCommand.findMetadataKey}
                />
              </div>
              <div className="field">
                <label htmlFor="fsFindMetadataValue">Find metadata value</label>
                <input
                  id="fsFindMetadataValue"
                  name="fsFindMetadataValue"
                  defaultValue={liveData.fsCommand.findMetadataValue}
                />
              </div>
              <div className="field">
                <label htmlFor="fsNodeId">Node ID</label>
                <input id="fsNodeId" name="fsNodeId" defaultValue={liveData.fsCommand.nodeId} />
              </div>
              <div className="field">
                <label htmlFor="oldPath">Old path</label>
                <input id="oldPath" name="oldPath" defaultValue={liveData.oldPath} />
              </div>
              <div className="field">
                <label htmlFor="newPath">New path</label>
                <input id="newPath" name="newPath" defaultValue={liveData.newPath} />
              </div>
              <div className="button-row">
                <button className="button secondary" type="submit">
                  Run command
                </button>
                <button
                  className="button secondary"
                  formAction="/api/admin-knowledge-fs-write"
                  formMethod="post"
                  type="submit"
                >
                  Run write/append
                </button>
              </div>
            </form>
            <KnowledgeFsCommandReference />
            <KnowledgeFsCommandResult state={liveData.fsCommand} />
          </article>

          <article id="entities" className="panel">
            <div className="panel-header">
              <div>
                <h2>Entity browser</h2>
                <small>Live graph traversal and linked KnowledgeFS documents</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            <form className="form-grid" action="/" method="get">
              <input type="hidden" name="spaceId" value={activeWorkspaceId} />
              <div className="field">
                <label htmlFor="entityId">Entity ID</label>
                <input id="entityId" name="entityId" defaultValue={liveData.entityId} />
              </div>
              <div className="button-row">
                <button className="button secondary" type="submit">
                  Traverse graph
                </button>
              </div>
            </form>
            {liveData.graph ? (
              <>
                <div className="status-list">
                  <StatusRow
                    label="Graph traversal"
                    value={`depth ${liveData.graph.metrics.depthReached}, fanout ${liveData.graph.metrics.fanout}, max ${liveData.graph.metrics.maxNodes}`}
                  />
                  <StatusRow
                    label="Relations"
                    value={`${liveData.graph.relations.length} explored`}
                  />
                </div>
                <div className="entity-layout">
                  <div className="entity-list" aria-label="Entities">
                    {liveData.graph.entities.map((entity, index) => (
                      <div className="entity-node" key={graphEntityRowKey(entity, index)}>
                        <div>
                          <strong>{entity.name}</strong>
                          <span>
                            {entity.type} - depth {entity.depth}
                          </span>
                        </div>
                        <em>{formatPercent(entity.confidence)}</em>
                      </div>
                    ))}
                  </div>
                  <div className="graph-strip" aria-label="Relations">
                    {liveData.graph.relations.map((relation, index) => (
                      <div className="relation-line" key={graphRelationRowKey(relation, index)}>
                        <span>{relation.subjectEntityId}</span>
                        <strong>{relation.type}</strong>
                        <span>{relation.objectEntityId}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <EmptyState label="Enter an entity ID to traverse the live graph" />
            )}
          </article>

          <article id="semantic-views" className="panel">
            <div className="panel-header">
              <div>
                <h2>Semantic views</h2>
                <small>{semanticViewStatus.description}</small>
              </div>
              <span className={`badge ${semanticViewStatus.badgeStatus}`}>
                {semanticViewStatus.badge}
              </span>
            </div>
            <div className="semantic-view-grid" aria-label="Semantic view counts">
              <div className="semantic-card">
                <span>Topic browser</span>
                <strong>{liveData.topicView?.items.length ?? 0}</strong>
                <em>/knowledge/by-topic</em>
              </div>
              <div className="semantic-card">
                <span>Readable entities</span>
                <strong>
                  {liveData.entityView
                    ? liveData.entityView.items.filter(isReadableSemanticEntityEntry).length
                    : 0}
                </strong>
                <em>/knowledge/by-entity</em>
              </div>
              <div className="semantic-card">
                <span>Communities</span>
                <strong>{liveData.communityView?.items.length ?? 0}</strong>
                <em>/knowledge/by-community</em>
              </div>
              <div className="semantic-card">
                <span>Workspace</span>
                <strong>{liveData.activeWorkspace.name}</strong>
                <em>{activeWorkspaceId}</em>
              </div>
            </div>
            <form action="/api/admin-semantic-views" className="button-row" method="post">
              <input type="hidden" name="knowledgeSpaceId" value={activeWorkspaceId} />
              <input type="hidden" name="limit" value="50" />
              <button
                className="button secondary"
                name="action"
                value="materialize-topic"
                type="submit"
              >
                Materialize topic view
              </button>
              <button
                className="button secondary"
                name="action"
                value="extract-entities"
                type="submit"
              >
                Extract entities
              </button>
              <button
                className="button secondary"
                name="action"
                value="materialize-communities"
                type="submit"
              >
                Materialize communities
              </button>
            </form>
            <h3>Communities</h3>
            <SemanticCommunityTable
              list={liveData.communityView}
              emptyLabel="No communities yet; run entity extraction and community materialization first"
            />
            <h3>Topics</h3>
            <SemanticTopicTable
              list={liveData.topicView}
              emptyLabel="No topic entries yet; run topic-view materialization or inspect Documents"
            />
            <h3>Entities</h3>
            <SemanticEntityTable
              list={liveData.entityView}
              emptyLabel="No entity entries yet; run entity extraction and graph indexing first"
            />
          </article>

          <article id="document-diff" className="panel">
            <div className="panel-header">
              <div>
                <h2>Document diff</h2>
                <small>Live KnowledgeFS text and semantic diff</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            <form className="form-grid" action="/" method="get">
              <input type="hidden" name="spaceId" value={activeWorkspaceId} />
              <div className="field">
                <label htmlFor="diffOldPath">Old path</label>
                <input id="diffOldPath" name="oldPath" defaultValue={liveData.oldPath} />
              </div>
              <div className="field">
                <label htmlFor="diffNewPath">New path</label>
                <input id="diffNewPath" name="newPath" defaultValue={liveData.newPath} />
              </div>
              <div className="button-row">
                <button className="button secondary" type="submit">
                  Run diff
                </button>
              </div>
            </form>
            {liveData.diff ? (
              <DocumentDiffView diff={liveData.diff} />
            ) : (
              <EmptyState label="Choose two KnowledgeFS paths to compare" />
            )}
          </article>

          <article id="golden-questions" className="panel">
            <div className="panel-header">
              <div>
                <h2>Golden questions</h2>
                <small>Live expected evidence and annotation queue</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            <form action="/api/admin-golden-question" className="form-grid" method="post">
              <input type="hidden" name="action" value="create" />
              <input type="hidden" name="knowledgeSpaceId" value={activeWorkspaceId} />
              <div className="field">
                <label htmlFor="golden-question">Question</label>
                <textarea id="golden-question" name="question" rows={3} />
              </div>
              <div className="field">
                <label htmlFor="expected-evidence">Expected evidence</label>
                <input id="expected-evidence" name="expectedEvidenceIds" />
              </div>
              <div className="field">
                <label htmlFor="golden-tags">Tags</label>
                <input id="golden-tags" name="tags" />
              </div>
              <div className="button-row">
                <button className="button" type="submit">
                  Create question
                </button>
              </div>
            </form>
            <form action="/api/admin-golden-question" className="form-grid" method="post">
              <input type="hidden" name="knowledgeSpaceId" value={activeWorkspaceId} />
              <div className="field">
                <label htmlFor="selected-question">Question ID</label>
                <input id="selected-question" name="questionId" />
              </div>
              <div className="field">
                <label htmlFor="selected-question-text">Question</label>
                <textarea id="selected-question-text" name="question" rows={2} />
              </div>
              <div className="field">
                <label htmlFor="selected-question-evidence">Expected evidence</label>
                <input id="selected-question-evidence" name="expectedEvidenceIds" />
              </div>
              <div className="field">
                <label htmlFor="selected-question-tags">Tags</label>
                <input id="selected-question-tags" name="tags" />
              </div>
              <div className="button-row">
                <button className="button secondary" name="action" value="update" type="submit">
                  Update selected
                </button>
                <button className="button secondary" name="action" value="delete" type="submit">
                  Delete selected
                </button>
              </div>
            </form>
            <GoldenQuestionAnnotationForm
              activeWorkspaceId={activeWorkspaceId}
              firstQuestionId={liveData.goldenQuestions?.items[0]?.id}
            />
            <GoldenQuestionTable list={liveData.goldenQuestions} />
          </article>

          <article id="evaluation-dashboard" className="panel wide-panel">
            <div className="panel-header">
              <div>
                <h2>Evaluation dashboard</h2>
                <small>Live queue summary from golden questions</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            <div className="semantic-view-grid" aria-label="Evaluation scorecards">
              <div className="semantic-card">
                <span>Total questions</span>
                <strong>{evaluationStats.total}</strong>
                <em>golden set</em>
              </div>
              <div className="semantic-card">
                <span>Annotated</span>
                <strong>{evaluationStats.annotated}</strong>
                <em>human review</em>
              </div>
              <div className="semantic-card">
                <span>Bad cases</span>
                <strong>{evaluationStats.badCases}</strong>
                <em>production capture</em>
              </div>
              <div className="semantic-card">
                <span>Pending</span>
                <strong>{evaluationStats.pending}</strong>
                <em>queue</em>
              </div>
            </div>
            <form
              id="bad-case-capture"
              className="form-grid"
              action="/api/admin-bad-case"
              method="post"
            >
              <input type="hidden" name="knowledgeSpaceId" value={activeWorkspaceId} />
              <div className="panel-header">
                <div>
                  <h3>Production bad-case capture</h3>
                  <small>Trace and evidence context</small>
                </div>
                <span className="badge review">Eval queue</span>
              </div>
              <div className="field">
                <label htmlFor="bad-case-trace">Trace ID</label>
                <input
                  id="bad-case-trace"
                  name="traceId"
                  defaultValue={retrievalResult.traceId ?? ""}
                />
              </div>
              <div className="field">
                <label htmlFor="bad-case-reason">Reason</label>
                <textarea id="bad-case-reason" name="reason" rows={3} />
              </div>
              <div className="field">
                <label htmlFor="bad-case-tags">Tags</label>
                <input id="bad-case-tags" name="tags" />
              </div>
              <div className="button-row">
                <button className="button" type="submit">
                  Add to eval queue
                </button>
              </div>
            </form>
          </article>

          <article id="retrieval-studio" className="panel wide-panel">
            <div className="panel-header">
              <div>
                <h2>Retrieval Studio</h2>
                <small>Live evidence from the latest query trace</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            {liveData.trace ? (
              <>
                <div className="status-list">
                  <StatusRow label="Trace" value={liveData.trace.id} mono />
                  <StatusRow label="Mode" value={liveData.trace.mode} />
                  <StatusRow label="Query" value={liveData.trace.query} />
                </div>
                <KnowledgeFsTable
                  list={liveData.queryEvidence}
                  emptyLabel="No evidence entries recorded for this trace"
                />
              </>
            ) : (
              <EmptyState label="Run a query to inspect live retrieval evidence" />
            )}
          </article>

          <article id="trace" className="panel">
            <div className="panel-header">
              <div>
                <h2>Trace review</h2>
                <small>Live recall, rerank, and evidence path</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            {liveData.trace ? (
              <TraceReview trace={liveData.trace} />
            ) : (
              <EmptyState label="Run a query to load a trace" />
            )}
          </article>

          <article id="trace-comparison" className="panel wide-panel">
            <div className="panel-header">
              <div>
                <h2>Trace comparison</h2>
                <small>Live side-by-side trace comparison</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            <form className="form-grid" action="/" method="get">
              <input type="hidden" name="spaceId" value={activeWorkspaceId} />
              {retrievalResult.traceId ? (
                <input type="hidden" name="traceId" value={retrievalResult.traceId} />
              ) : null}
              <div className="field">
                <label htmlFor="compareTraceId">Compare trace ID</label>
                <input id="compareTraceId" name="compareTraceId" />
              </div>
              <div className="button-row">
                <button className="button secondary" type="submit">
                  Compare traces
                </button>
              </div>
            </form>
            {liveData.trace && liveData.compareTrace ? (
              <TraceComparisonView left={liveData.trace} right={liveData.compareTrace} />
            ) : (
              <EmptyState label="Provide a second trace ID to compare with the latest query" />
            )}
          </article>

          <article id="failed-query-diagnostics" className="panel wide-panel">
            <div className="panel-header">
              <div>
                <h2>Failed query diagnostics</h2>
                <small>Live evidence, missing evidence, and conflict entries</small>
              </div>
              <span className="badge ok">Live</span>
            </div>
            {liveData.trace ? (
              <div className="trend-layout">
                <section aria-label="Candidate ranking">
                  <h3>Candidate ranking</h3>
                  <KnowledgeFsTable
                    list={liveData.queryEvidence}
                    emptyLabel="No ranked evidence entries"
                  />
                </section>
                <section aria-label="Filter exclusions">
                  <h3>Filter exclusions</h3>
                  <KnowledgeFsTable
                    list={liveData.queryMissing ?? liveData.queryConflicts}
                    emptyLabel="No missing or conflicting evidence entries"
                  />
                </section>
              </div>
            ) : (
              <EmptyState label="Run a query to inspect live diagnostics" />
            )}
          </article>
        </section>
      </section>
    </main>
  );
}

function StatusRow({
  label,
  mono = false,
  value,
}: {
  readonly label: string;
  readonly mono?: boolean;
  readonly value: string;
}) {
  return (
    <div className="status-row">
      <strong>{label}</strong>
      <span className={mono ? "mono" : undefined}>{value}</span>
    </div>
  );
}

function EmptyState({ label }: { readonly label: string }) {
  return (
    <div className="status-list">
      <div className="status-row">
        <strong>Status</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function KnowledgeFsTable({
  emptyLabel,
  list,
}: {
  readonly emptyLabel: string;
  readonly list?: AdminKnowledgeFsList | undefined;
}) {
  if (!list || list.items.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <div className="table" aria-label={`KnowledgeFS ${list.path}`}>
      <div className="table-row">
        <strong>{list.path}</strong>
        <span>{list.truncated ? "truncated" : `${list.items.length} entries`}</span>
      </div>
      {list.items.map((entry) => (
        <KnowledgeFsRow entry={entry} key={`${entry.kind}:${entry.path}`} />
      ))}
    </div>
  );
}

function KnowledgeFsRow({ entry }: { readonly entry: AdminKnowledgeFsEntry }) {
  return (
    <div className="table-row">
      <div>
        <strong>{entry.name}</strong>
        <div className="mono">{entry.path}</div>
        <div className="mono">{entry.resourceType ?? entry.kind}</div>
      </div>
      <span>{entry.version ? `v${entry.version}` : (entry.targetId ?? entry.kind)}</span>
    </div>
  );
}

function KnowledgeFsCommandReference() {
  return (
    <div className="status-list" aria-label="KnowledgeFS commands">
      <StatusRow
        label="Commands"
        value="ls, tree, cat, stat, grep, find, diff, open_node, write, append"
      />
      <StatusRow label="Path commands" value="ls/tree/cat/stat/grep/find use Path" />
      <StatusRow label="Diff" value="diff uses Old path and New path" />
      <StatusRow label="Open node" value="open_node uses Node ID" />
      <StatusRow label="Write" value="write overwrites Path with Write text" />
      <StatusRow label="Append" value="append adds Write text to Path" />
    </div>
  );
}

function KnowledgeFsCommandResult({ state }: { readonly state: AdminKnowledgeFsCommandState }) {
  if (state.error) {
    return <EmptyState label={state.error} />;
  }

  if (!state.result) {
    if (state.command === "write" || state.command === "append") {
      return <EmptyState label="Use Run write/append to submit this write command" />;
    }

    return (
      <EmptyState label={`Select ${state.command} parameters and run a KnowledgeFS command`} />
    );
  }

  if (state.command === "cat") {
    const result = state.result as AdminKnowledgeFsCat;
    return (
      <div className="table" aria-label="KnowledgeFS cat result">
        <StatusRow label="cat" value={result.path} mono />
        <StatusRow label="Content type" value={result.contentType} />
        <StatusRow label="Length" value={`${result.text.length} chars`} />
        <div className="table-row">
          <strong>Text</strong>
          <pre>{result.text.slice(0, 4000)}</pre>
        </div>
      </div>
    );
  }

  if (state.command === "stat") {
    const result = state.result as AdminKnowledgeFsStat;
    return (
      <div className="status-list" aria-label="KnowledgeFS stat result">
        <StatusRow label="Path" value={result.path} mono />
        <StatusRow label="Resource" value={result.resourceType} />
        <StatusRow label="Target ID" value={result.targetId} mono />
        <StatusRow label="Version" value={result.version ? `v${result.version}` : "none"} />
        <StatusRow label="Content type" value={result.contentType ?? "none"} />
        <StatusRow label="Parser status" value={result.parserStatus ?? "none"} />
        <StatusRow label="Size" value={result.sizeBytes ? formatBytes(result.sizeBytes) : "none"} />
        <StatusRow label="SHA-256" value={result.sha256 ? shortId(result.sha256) : "none"} mono />
        <StatusRow label="Metadata" value={formatJson(result.metadata)} mono />
      </div>
    );
  }

  if (state.command === "grep") {
    const result = state.result as AdminKnowledgeFsGrep;
    if (result.matches.length === 0) {
      return <EmptyState label="grep returned no matches" />;
    }

    return (
      <div className="table" aria-label="KnowledgeFS grep result">
        <div className="table-row">
          <strong>{result.path}</strong>
          <span>{result.truncated ? "truncated" : `${result.matches.length} matches`}</span>
        </div>
        {result.matches.map((match, index) => (
          <div className="table-row" key={`${match.path}:${match.startOffset}:${index}`}>
            <div>
              <strong>{match.kind}</strong>
              <div>{match.snippet}</div>
              <div className="mono">{match.path}</div>
            </div>
            <span>
              {match.startOffset}-{match.endOffset}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (state.command === "find") {
    return (
      <KnowledgeFsTable
        list={state.result as AdminKnowledgeFsList}
        emptyLabel="find returned no entries"
      />
    );
  }

  if (state.command === "tree") {
    return <KnowledgeFsTreeView tree={state.result as AdminKnowledgeFsTree} />;
  }

  if (state.command === "diff") {
    return <DocumentDiffView diff={state.result as AdminKnowledgeFsDiff} />;
  }

  if (state.command === "open_node") {
    const result = state.result as AdminKnowledgeFsOpenNode;
    return (
      <div className="status-list" aria-label="KnowledgeFS open_node result">
        <StatusRow label="Node ID" value={result.node.id} mono />
        <StatusRow label="Kind" value={result.node.kind} />
        <StatusRow label="Document" value={result.citation.documentAssetId} mono />
        <StatusRow label="Parse artifact" value={result.citation.parseArtifactId} mono />
        <StatusRow
          label="Offsets"
          value={`${result.citation.startOffset}-${result.citation.endOffset}`}
        />
        <StatusRow label="Text" value={result.node.text.slice(0, 800)} />
      </div>
    );
  }

  if (state.command === "write" || state.command === "append") {
    const result = state.result as AdminKnowledgeFsWrite;

    return (
      <div className="status-list" aria-label="KnowledgeFS write result">
        <StatusRow label="Mode" value={result.mode} />
        <StatusRow label="Path" value={result.path} mono />
        <StatusRow label="Bytes written" value={formatBytes(result.bytesWritten)} />
        <StatusRow label="Target ID" value={result.targetId} mono />
        <StatusRow label="Version" value={`v${result.version}`} />
        <StatusRow label="Object key" value={result.objectKey} mono />
      </div>
    );
  }

  return (
    <KnowledgeFsTable
      list={state.result as AdminKnowledgeFsList}
      emptyLabel="ls returned no entries"
    />
  );
}

function KnowledgeFsTreeView({ tree }: { readonly tree: AdminKnowledgeFsTree }) {
  return (
    <div className="table" aria-label="KnowledgeFS tree result">
      <div className="table-row">
        <strong>{tree.path}</strong>
        <span>{tree.truncated ? "truncated" : "tree"}</span>
      </div>
      <KnowledgeFsTreeNodeRow node={tree.root} depth={0} />
    </div>
  );
}

function KnowledgeFsTreeNodeRow({
  depth,
  node,
}: {
  readonly depth: number;
  readonly node: AdminKnowledgeFsTreeNode;
}) {
  return (
    <>
      <div className="table-row">
        <div>
          <strong>
            {"  ".repeat(depth)}
            {node.name}
          </strong>
          <div className="mono">{node.path}</div>
        </div>
        <span>{node.resourceType ?? node.kind}</span>
      </div>
      {(node.children ?? []).map((child) => (
        <KnowledgeFsTreeNodeRow
          depth={depth + 1}
          key={`${child.kind}:${child.path}`}
          node={child}
        />
      ))}
    </>
  );
}

function SemanticTopicTable({
  emptyLabel,
  list,
}: {
  readonly emptyLabel: string;
  readonly list?: AdminKnowledgeFsList | undefined;
}) {
  if (!list || list.items.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <div className="table" aria-label={`Semantic topics ${list.path}`}>
      <div className="table-row">
        <strong>Topic groups</strong>
        <span>{formatEntryCount(list.items.length, "topic")}</span>
      </div>
      {list.items.map((entry) => {
        const topicSlug = metadataString(entry.metadata, "topicSlug") ?? entry.name;
        const topicName = metadataString(entry.metadata, "topicName") ?? titleizeSlug(topicSlug);

        return (
          <div className="table-row" key={`${entry.kind}:${entry.path}`}>
            <div>
              <strong>{topicName}</strong>
              <div>{formatTopicKind(entry.kind)}</div>
              <div className="mono">{entry.path}</div>
            </div>
            <span>{topicSlug}</span>
          </div>
        );
      })}
    </div>
  );
}

function SemanticCommunityTable({
  emptyLabel,
  list,
}: {
  readonly emptyLabel: string;
  readonly list?: AdminKnowledgeFsList | undefined;
}) {
  if (!list || list.items.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return (
    <div className="table" aria-label={`Semantic communities ${list.path}`}>
      <div className="table-row">
        <strong>Knowledge communities</strong>
        <span>{formatEntryCount(list.items.length, "community")}</span>
      </div>
      {list.items.map((entry) => {
        const title = metadataString(entry.metadata, "title") ?? titleizeSlug(entry.name);
        const summary = metadataString(entry.metadata, "summary") ?? "Summary pending";
        const entityCount = metadataNumber(entry.metadata, "entityCount");
        const documentCount = metadataNumber(entry.metadata, "documentCount");

        return (
          <div className="table-row" key={`${entry.kind}:${entry.path}`}>
            <div>
              <strong>{title}</strong>
              <div>{summary}</div>
              <div className="mono">{entry.path}</div>
            </div>
            <span>
              {formatOptionalCounts([
                entityCount === undefined ? undefined : formatEntryCount(entityCount, "entity"),
                documentCount === undefined
                  ? undefined
                  : formatEntryCount(documentCount, "document"),
              ])}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SemanticEntityTable({
  emptyLabel,
  list,
}: {
  readonly emptyLabel: string;
  readonly list?: AdminKnowledgeFsList | undefined;
}) {
  if (!list || list.items.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  const visibleEntries = list.items.filter(isReadableSemanticEntityEntry);
  if (visibleEntries.length === 0) {
    return (
      <div className="table" aria-label={`Semantic entities ${list.path}`}>
        <div className="table-row">
          <strong>Readable entities</strong>
          <span>0 entries</span>
        </div>
        <div className="table-row">
          <div>
            <strong>No readable entities yet</strong>
            <div>
              Only low-signal numeric entries were found; run extraction after richer text is
              uploaded
            </div>
          </div>
          <span>{formatEntryCount(list.items.length, "hidden")}</span>
        </div>
      </div>
    );
  }

  const hiddenCount = list.items.length - visibleEntries.length;

  return (
    <div className="table" aria-label={`Semantic entities ${list.path}`}>
      <div className="table-row">
        <strong>Readable entities</strong>
        <span>{formatEntryCount(visibleEntries.length, "entity")}</span>
      </div>
      {visibleEntries.map((entry) => {
        const entityType = metadataString(entry.metadata, "type") ?? "entity";
        const sourceNodeCount = metadataNumber(entry.metadata, "sourceNodeCount");
        const entityId = metadataString(entry.metadata, "entityId") ?? entry.targetId;

        return (
          <div className="table-row" key={`${entry.kind}:${entry.path}`}>
            <div>
              <strong>{entry.name}</strong>
              <div>
                {formatEntityType(entityType)}
                {sourceNodeCount === undefined
                  ? ""
                  : ` - seen in ${formatEntryCount(sourceNodeCount, "node")}`}
              </div>
              {entityId ? <div className="mono">Graph ID {shortId(entityId)}</div> : null}
            </div>
            <span>{entry.kind}</span>
          </div>
        );
      })}
      {hiddenCount > 0 ? (
        <div className="table-row">
          <div>
            <strong>Hidden numeric noise</strong>
            <div>Plain numbers are suppressed from this operator view</div>
          </div>
          <span>{formatEntryCount(hiddenCount, "entry")}</span>
        </div>
      ) : null}
    </div>
  );
}

function DocumentDiffView({ diff }: { readonly diff: AdminKnowledgeFsDiff }) {
  return (
    <>
      <div className="status-list">
        <StatusRow label="Old path" value={diff.oldPath} mono />
        <StatusRow label="New path" value={diff.newPath} mono />
        <StatusRow
          label="Stats"
          value={`+${diff.stats.insert} / -${diff.stats.delete} / = ${diff.stats.equal}`}
        />
      </div>
      <div className="diff-layout">
        <div aria-label="Text diff">
          <h3>Text diff</h3>
          <div className="diff-lines">
            {diff.operations.slice(0, 20).map((operation, index) => (
              <div className={`diff-line ${operation.kind}`} key={`${operation.kind}-${index}`}>
                <span>{operation.kind}</span>
                <p>{operation.text}</p>
              </div>
            ))}
          </div>
        </div>
        <div aria-label="Semantic summary">
          <h3>Semantic summary</h3>
          <p>{diff.semantic?.summary ?? "Semantic diff was not returned."}</p>
          <div className="table">
            {(diff.semantic?.changes ?? []).map((change, index) => (
              <div
                className="table-row"
                key={adminRowKey("semantic-change", change.summary, index)}
              >
                <div>
                  <strong>{change.category}</strong>
                  <div className="mono">{change.evidence.join(", ")}</div>
                </div>
                <span>{change.summary}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function GoldenQuestionTable({ list }: { readonly list?: AdminGoldenQuestionList | undefined }) {
  if (!list || list.items.length === 0) {
    return <EmptyState label="No golden questions found" />;
  }

  return (
    <div className="table" aria-label="Golden question list">
      <div className="table-row">
        <strong>Question</strong>
        <span>Expected evidence</span>
      </div>
      {list.items.map((question, index) => (
        <div className="table-row" key={adminRowKey("golden-question", question.id, index)}>
          <div>
            <strong>{question.question}</strong>
            <div className="mono">{question.id}</div>
            <div className="mono">{question.tags.join(", ") || "untagged"}</div>
          </div>
          <span>{question.expectedEvidenceIds.join(", ") || "None"}</span>
        </div>
      ))}
    </div>
  );
}

function GoldenQuestionAnnotationForm({
  activeWorkspaceId,
  firstQuestionId,
}: {
  readonly activeWorkspaceId: string;
  readonly firstQuestionId?: string | undefined;
}) {
  return (
    <form action="/api/admin-golden-annotation" className="form-grid" method="post">
      <input type="hidden" name="knowledgeSpaceId" value={activeWorkspaceId} />
      <div className="panel-header">
        <div>
          <h3>Human annotation</h3>
          <small>Evidence relevance and answer correctness</small>
        </div>
        <span className="badge review">Review queue</span>
      </div>
      <div className="field">
        <label htmlFor="annotation-question-id">Question ID</label>
        <input id="annotation-question-id" name="questionId" defaultValue={firstQuestionId ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="answer-correctness">Answer correctness</label>
        <select id="answer-correctness" name="answerCorrectness" defaultValue="incorrect">
          <option value="correct">correct</option>
          <option value="partially-correct">partially-correct</option>
          <option value="incorrect">incorrect</option>
          <option value="not-answerable">not-answerable</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="evidence-relevance">Evidence relevance</label>
        <textarea id="evidence-relevance" name="evidenceRelevance" rows={3} />
      </div>
      <div className="field">
        <label htmlFor="annotation-note">Annotation note</label>
        <textarea id="annotation-note" name="note" rows={3} />
      </div>
      <div className="button-row">
        <button className="button" type="submit">
          Submit annotation
        </button>
      </div>
    </form>
  );
}

function TraceReview({ trace }: { readonly trace: AdminAnswerTrace }) {
  const summary = createTraceSummary({
    steps: trace.steps.map((step) => ({ attributes: step.metadata, name: step.name })),
  });
  const treeSearch = extractReasoningTreeSearchTrace(trace);

  return (
    <>
      <div className="table">
        <StatusRow label="Route" value={summary.route} />
        <StatusRow label="Recall candidates" value={String(summary.recallCandidates)} />
        <StatusRow label="Filters" value={summary.filters} />
        <StatusRow label="Rerank" value={summary.rerank} />
        <StatusRow label="Evidence" value={summary.evidence} />
      </div>
      {treeSearch ? (
        <div className="table" aria-label="Reasoning tree search trace">
          <StatusRow label="Tree search" value={treeSearch.strategy} />
          <StatusRow label="Selected section" value={treeSearch.selectedSectionPath} />
          <StatusRow label="Selected node" value={treeSearch.selectedNodeId} mono />
          <StatusRow label="Inspected nodes" value={treeSearch.inspectedNodeIds} mono />
          <StatusRow label="Opened ranges" value={treeSearch.openedRanges} />
          <StatusRow label="Final evidence" value={treeSearch.finalEvidenceNodeIds} mono />
          <StatusRow label="Reasoning" value={treeSearch.reasoning} />
        </div>
      ) : null}
      <div className="table">
        {trace.steps.map((step, index) => (
          <div
            className="table-row"
            key={adminRowKey("trace-step", `${step.name}:${step.startedAt}`, index)}
          >
            <div>
              <strong>{step.name}</strong>
              <div className="mono">{step.startedAt}</div>
            </div>
            <span>{step.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}

interface ReasoningTreeSearchTraceView {
  readonly finalEvidenceNodeIds: string;
  readonly inspectedNodeIds: string;
  readonly openedRanges: string;
  readonly reasoning: string;
  readonly selectedNodeId: string;
  readonly selectedSectionPath: string;
  readonly strategy: string;
}

function extractReasoningTreeSearchTrace(
  trace: AdminAnswerTrace,
): ReasoningTreeSearchTraceView | undefined {
  for (const step of trace.steps) {
    const directTrace = traceViewFromRecord(recordFromUnknown(step.metadata.reasoningTreeSearch));
    if (directTrace) {
      return directTrace;
    }

    const evidenceBundle = recordFromUnknown(step.metadata.evidenceBundle);
    const items = arrayFromRecord(evidenceBundle, "items");
    const itemTrace = items
      ?.map((item) => {
        const metadata = recordFromUnknown(recordFromUnknown(item)?.metadata);
        return traceViewFromRecord(recordFromUnknown(metadata?.reasoningTreeSearch));
      })
      .find((traceView) => traceView !== undefined);

    if (itemTrace) {
      return itemTrace;
    }
  }

  return undefined;
}

function traceViewFromRecord(
  trace: Readonly<Record<string, unknown>> | undefined,
): ReasoningTreeSearchTraceView | undefined {
  if (!trace) {
    return undefined;
  }

  return {
    finalEvidenceNodeIds: formatStringArray(arrayFromRecord(trace, "finalEvidenceNodeIds")),
    inspectedNodeIds: formatStringArray(arrayFromRecord(trace, "inspectedNodeIds")),
    openedRanges: formatOpenedRanges(arrayFromRecord(trace, "openedRanges")),
    reasoning: stringFromRecord(trace, "reasoning") ?? "No tree-search reasoning recorded.",
    selectedNodeId: stringFromRecord(trace, "selectedNodeId") ?? "unknown",
    selectedSectionPath: formatStringArray(arrayFromRecord(trace, "selectedSectionPath")),
    strategy: stringFromRecord(trace, "strategy") ?? "unknown",
  };
}

function formatOpenedRanges(values: readonly unknown[] | undefined): string {
  if (!values || values.length === 0) {
    return "none";
  }

  return values
    .map((value) => {
      const range = recordFromUnknown(value);
      if (!range) {
        return undefined;
      }

      const sectionPath = formatStringArray(arrayFromRecord(range, "sectionPath"));
      const startPage = numberFromRecord(range, "startPage");
      const endPage = numberFromRecord(range, "endPage");
      const startOffset = numberFromRecord(range, "startOffset");
      const endOffset = numberFromRecord(range, "endOffset");
      const page =
        startPage === undefined
          ? "page unknown"
          : endPage !== undefined && endPage !== startPage
            ? `pages ${startPage}-${endPage}`
            : `page ${startPage}`;
      const offset =
        startOffset === undefined
          ? ""
          : endOffset !== undefined && endOffset !== startOffset
            ? ` offset ${startOffset}-${endOffset}`
            : ` offset ${startOffset}`;

      return `${sectionPath} (${page}${offset})`;
    })
    .filter((value): value is string => value !== undefined)
    .join("; ");
}

function formatStringArray(values: readonly unknown[] | undefined): string {
  const strings = values?.filter((value): value is string => typeof value === "string") ?? [];
  return strings.length > 0 ? strings.join(" / ") : "none";
}

function recordFromUnknown(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function arrayFromRecord(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly unknown[] | undefined {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

function stringFromRecord(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

function numberFromRecord(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function TraceComparisonView({
  left,
  right,
}: {
  readonly left: AdminAnswerTrace;
  readonly right: AdminAnswerTrace;
}) {
  const comparison = createTraceComparison({
    traces: [
      {
        id: left.id,
        label: "baseline",
        steps: left.steps.map((step) => ({ attributes: step.metadata, name: step.name })),
      },
      {
        id: right.id,
        label: "challenger",
        steps: right.steps.map((step) => ({ attributes: step.metadata, name: step.name })),
      },
    ],
  });

  return (
    <>
      <div className="semantic-view-grid" aria-label="Trace comparison deltas">
        <div className="semantic-card">
          <span>Recall delta</span>
          <strong>{comparison.deltas.recallDeltaLabel}</strong>
          <em>{comparison.deltas.routeChangeLabel}</em>
        </div>
        <div className="semantic-card">
          <span>Citation delta</span>
          <strong>{comparison.deltas.citationDeltaLabel}</strong>
          <em>{comparison.deltas.rerankChangeLabel}</em>
        </div>
        <div className="semantic-card">
          <span>Filter changes</span>
          <strong>{comparison.deltas.filterChangeLabel}</strong>
          <em>bounded trace steps</em>
        </div>
      </div>
      <div className="strategy-grid" aria-label="Trace columns">
        {comparison.columns.map((column, index) => (
          <section
            className="strategy-column"
            key={adminRowKey("trace-column", column.traceId, index)}
          >
            <div className="panel-header">
              <div>
                <h3>{column.label}</h3>
                <small className="mono">{column.traceId}</small>
              </div>
              <span className="badge ok">{column.stepCountLabel}</span>
            </div>
            <div className="status-list">
              <StatusRow label="Route" value={column.routeLabel} />
              <StatusRow label="Recall" value={column.recallCandidatesLabel} />
              <StatusRow label="Rerank" value={column.rerankLabel} />
              <StatusRow label="Evidence" value={column.evidenceLabel} />
              <StatusRow label="Filters" value={column.filtersLabel} />
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function UploadResultCard({ result }: { readonly result: AdminUploadResult }) {
  if (result.status === "error") {
    return (
      <section className="result-card fail" aria-label="Upload failed" aria-live="polite">
        <div className="panel-header">
          <div>
            <h3>Upload failed</h3>
            <small>{result.error}</small>
          </div>
          <span className="badge fail">failed</span>
        </div>
      </section>
    );
  }

  const documentHref = `/documents/${encodeURIComponent(result.spaceId)}/${encodeURIComponent(result.documentId)}`;
  const artifactHref = `${documentHref}/parse-artifacts/${result.version}`;

  return (
    <section className="result-card" aria-label="Upload result" aria-live="polite">
      <div className="panel-header">
        <div>
          <h3>Upload result</h3>
          <small>{result.filename}</small>
        </div>
        <span className={`badge ${result.parserStatus === "failed" ? "fail" : "ok"}`}>
          {result.parserStatus}
        </span>
      </div>
      <div className="status-list">
        <StatusRow label="Document id" value={result.documentId} mono />
        <StatusRow label="Size" value={formatBytes(result.sizeBytes)} />
        <StatusRow label="SHA-256" value={result.sha256.slice(0, 12)} mono />
      </div>
      <div className="button-row">
        <a className="button secondary" href={documentHref}>
          Open document status
        </a>
        <a className="button secondary" href={artifactHref}>
          Open parse artifact
        </a>
      </div>
    </section>
  );
}

async function loadAdminLiveData({
  queryResult,
  searchParams,
  uploadResult,
  workspaceOptions,
}: {
  readonly queryResult: AdminQueryResult | null;
  readonly searchParams: Record<string, string | string[] | undefined>;
  readonly uploadResult: AdminUploadResult | null;
  readonly workspaceOptions: readonly AdminWorkspaceOption[];
}): Promise<AdminLiveData> {
  const activeWorkspace = selectActiveWorkspace(workspaceOptions, searchParams, uploadResult);
  const token = getAdminServerToken();
  const fsPath = firstSearchParam(searchParams.fsPath) || defaultKnowledgeFsPath;
  const fsCommand = parseKnowledgeFsCommand(firstSearchParam(searchParams.fsCommand));
  const fsLimit = firstSearchParam(searchParams.fsLimit) || "12";
  const rootFsLimit = parseFormPositiveInteger(fsLimit, 12);
  const fsDepth = firstSearchParam(searchParams.fsDepth) || "3";
  const fsGrepQuery = firstSearchParam(searchParams.fsGrepQuery) || "";
  const fsFindNameContains = firstSearchParam(searchParams.fsFindNameContains) || "";
  const fsFindResourceType = firstSearchParam(searchParams.fsFindResourceType) || "";
  const fsFindMetadataKey = firstSearchParam(searchParams.fsFindMetadataKey) || "";
  const fsFindMetadataValue = firstSearchParam(searchParams.fsFindMetadataValue) || "";
  const fsNodeId = firstSearchParam(searchParams.fsNodeId) || "";
  const fsWriteText = firstSearchParam(searchParams.fsWriteText) || "";
  const entityId = firstSearchParam(searchParams.entityId) || "";
  const oldPath = firstSearchParam(searchParams.oldPath) || "";
  const newPath = firstSearchParam(searchParams.newPath) || "";
  const traceId =
    firstSearchParam(searchParams.traceId) ||
    (queryResult?.status === "success" ? queryResult.traceId : undefined) ||
    "";
  const traceLookupId = isUuid(traceId) ? traceId : "";
  const compareTraceId = firstSearchParam(searchParams.compareTraceId) || "";
  const compareTraceLookupId = isUuid(compareTraceId) ? compareTraceId : "";

  if (!token) {
    return {
      activeWorkspace,
      entityId,
      errors: ["Admin API token is not configured"],
      fsCommand: {
        command: fsCommand,
        depth: fsDepth,
        findMetadataKey: fsFindMetadataKey,
        findMetadataValue: fsFindMetadataValue,
        findNameContains: fsFindNameContains,
        findResourceType: fsFindResourceType,
        grepQuery: fsGrepQuery,
        limit: fsLimit,
        nodeId: fsNodeId,
        writeText: fsWriteText,
      },
      fsPath,
      newPath,
      oldPath,
    };
  }

  const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
  const [
    rootFs,
    topicView,
    entityView,
    communityView,
    goldenQuestions,
    trace,
    compareTrace,
    queryEvidence,
    queryMissing,
    queryConflicts,
    graph,
    diff,
    manifest,
    status,
    failedCommits,
    activeLeases,
    fsck,
    gcDryRun,
    publishReadiness,
    fsCommandResult,
  ] = await Promise.all([
    loadLive("KnowledgeFS", () =>
      client.listKnowledgeFs({
        knowledgeSpaceId: activeWorkspace.id,
        limit: rootFsLimit,
        path: fsPath,
        token,
      }),
    ),
    loadLive("Topic view", () =>
      client.listSemanticView({
        knowledgeSpaceId: activeWorkspace.id,
        limit: 8,
        token,
        view: "by-topic",
      }),
    ),
    loadLive("Entity view", () =>
      client.listSemanticView({
        knowledgeSpaceId: activeWorkspace.id,
        limit: 8,
        token,
        view: "by-entity",
      }),
    ),
    loadLive("Community view", () =>
      client.listSemanticView({
        knowledgeSpaceId: activeWorkspace.id,
        limit: 8,
        token,
        view: "by-community",
      }),
    ),
    loadLive("Golden questions", () =>
      client.listGoldenQuestions({
        knowledgeSpaceId: activeWorkspace.id,
        limit: 12,
        token,
      }),
    ),
    traceLookupId
      ? loadLive("Answer trace", () => client.getAnswerTrace({ token, traceId: traceLookupId }))
      : emptyLive<AdminAnswerTrace>(),
    compareTraceLookupId
      ? loadLive("Compare trace", () =>
          client.getAnswerTrace({ token, traceId: compareTraceLookupId }),
        )
      : emptyLive<AdminAnswerTrace>(),
    traceLookupId
      ? loadLive("Query evidence", () =>
          client.listQueryEvidence({ limit: 12, token, traceId: traceLookupId }),
        )
      : emptyLive<AdminKnowledgeFsList>(),
    traceLookupId
      ? loadLive("Query missing evidence", () =>
          client.listQueryMissing({ limit: 12, token, traceId: traceLookupId }),
        )
      : emptyLive<AdminKnowledgeFsList>(),
    traceLookupId
      ? loadLive("Query conflicts", () =>
          client.listQueryConflicts({ limit: 12, token, traceId: traceLookupId }),
        )
      : emptyLive<AdminKnowledgeFsList>(),
    entityId
      ? loadLive("Graph traversal", () =>
          client.traverseGraph({
            depth: 2,
            entityId,
            fanout: 8,
            knowledgeSpaceId: activeWorkspace.id,
            maxNodes: 30,
            timeoutMs: 500,
            token,
          }),
        )
      : emptyLive<AdminGraphTraversal>(),
    oldPath && newPath
      ? loadLive("Document diff", () =>
          client.diffKnowledgeFs({
            knowledgeSpaceId: activeWorkspace.id,
            mode: "word",
            newPath,
            oldPath,
            semantic: true,
            token,
          }),
        )
      : emptyLive<AdminKnowledgeFsDiff>(),
    loadLive("KnowledgeSpace manifest", () =>
      client.getKnowledgeSpaceManifest({
        knowledgeSpaceId: activeWorkspace.id,
        token,
      }),
    ),
    loadLive("KnowledgeSpace status", () =>
      client.getKnowledgeSpaceStatus({
        knowledgeSpaceId: activeWorkspace.id,
        token,
      }),
    ),
    loadLive("KnowledgeSpace failed commits", () =>
      client.listStagedCommits({
        knowledgeSpaceId: activeWorkspace.id,
        limit: 5,
        token,
      }),
    ),
    loadLive("KnowledgeSpace active leases", () =>
      client.listActiveLeases({
        knowledgeSpaceId: activeWorkspace.id,
        limit: 5,
        token,
      }),
    ),
    loadLive("KnowledgeSpace fsck", () =>
      client.getKnowledgeFsck({
        check: "raw-objects",
        knowledgeSpaceId: activeWorkspace.id,
        token,
      }),
    ),
    loadLive("KnowledgeSpace staged-object GC dry-run", () =>
      client.getStagedObjectGcDryRun({
        knowledgeSpaceId: activeWorkspace.id,
        token,
      }),
    ),
    loadLive("Document readiness", () =>
      loadDocumentPublishReadiness({
        client,
        knowledgeSpaceId: activeWorkspace.id,
        searchParams,
        token,
        uploadResult,
      }),
    ),
    fsCommand === "ls" || fsCommand === "write" || fsCommand === "append"
      ? emptyLive<AdminKnowledgeFsCommandState["result"]>()
      : loadLive("KnowledgeFS command", () =>
          loadKnowledgeFsCommandResult({
            activeWorkspaceId: activeWorkspace.id,
            client,
            command: fsCommand,
            depth: fsDepth,
            findMetadataKey: fsFindMetadataKey,
            findMetadataValue: fsFindMetadataValue,
            findNameContains: fsFindNameContains,
            findResourceType: fsFindResourceType,
            grepQuery: fsGrepQuery,
            limit: fsLimit,
            newPath,
            nodeId: fsNodeId,
            oldPath,
            path: fsPath,
            token,
          }),
        ),
  ]);

  return {
    activeWorkspace,
    ...(activeLeases.value ? { activeLeases: activeLeases.value } : {}),
    ...(compareTrace.value ? { compareTrace: compareTrace.value } : {}),
    ...(communityView.value ? { communityView: communityView.value } : {}),
    ...(diff.value ? { diff: diff.value } : {}),
    entityId,
    ...(entityView.value ? { entityView: entityView.value } : {}),
    errors: [
      manifest.error,
      status.error,
      failedCommits.error,
      activeLeases.error,
      fsck.error,
      gcDryRun.error,
      goldenQuestions.error,
      visibleLiveDataError(trace.error),
      visibleLiveDataError(compareTrace.error),
      visibleLiveDataError(queryEvidence.error),
      visibleLiveDataError(queryMissing.error),
      visibleLiveDataError(queryConflicts.error),
    ].filter(Boolean) as string[],
    ...(failedCommits.value ? { failedCommits: failedCommits.value } : {}),
    fsCommand: {
      command: fsCommand,
      depth: fsDepth,
      ...(fsCommand === "ls" && rootFs.error ? { error: rootFs.error } : {}),
      ...(fsCommand !== "ls" && fsCommandResult.error ? { error: fsCommandResult.error } : {}),
      findMetadataKey: fsFindMetadataKey,
      findMetadataValue: fsFindMetadataValue,
      findNameContains: fsFindNameContains,
      findResourceType: fsFindResourceType,
      grepQuery: fsGrepQuery,
      limit: fsLimit,
      nodeId: fsNodeId,
      result: fsCommand === "ls" ? rootFs.value : fsCommandResult.value,
      writeText: fsWriteText,
    },
    ...(fsck.value ? { fsck: fsck.value } : {}),
    ...(gcDryRun.value ? { gcDryRun: gcDryRun.value } : {}),
    fsPath,
    ...(graph.value ? { graph: graph.value } : {}),
    ...(goldenQuestions.value ? { goldenQuestions: goldenQuestions.value } : {}),
    ...(manifest.value ? { manifest: manifest.value } : {}),
    newPath,
    oldPath,
    ...(publishReadiness.value ? { publishReadiness: publishReadiness.value } : {}),
    ...(queryConflicts.value ? { queryConflicts: queryConflicts.value } : {}),
    ...(queryEvidence.value ? { queryEvidence: queryEvidence.value } : {}),
    ...(queryMissing.value ? { queryMissing: queryMissing.value } : {}),
    ...(rootFs.value ? { rootFs: rootFs.value } : {}),
    ...(status.value ? { status: status.value } : {}),
    ...(topicView.value ? { topicView: topicView.value } : {}),
    ...(trace.value ? { trace: trace.value } : {}),
  };
}

async function loadKnowledgeFsCommandResult({
  activeWorkspaceId,
  client,
  command,
  depth,
  findMetadataKey,
  findMetadataValue,
  findNameContains,
  findResourceType,
  grepQuery,
  limit,
  newPath,
  nodeId,
  oldPath,
  path,
  token,
}: {
  readonly activeWorkspaceId: string;
  readonly client: AdminApiClient;
  readonly command: AdminKnowledgeFsCommand;
  readonly depth: string;
  readonly findMetadataKey: string;
  readonly findMetadataValue: string;
  readonly findNameContains: string;
  readonly findResourceType: string;
  readonly grepQuery: string;
  readonly limit: string;
  readonly newPath: string;
  readonly nodeId: string;
  readonly oldPath: string;
  readonly path: string;
  readonly token: string;
}): Promise<AdminKnowledgeFsCommandState["result"]> {
  const parsedLimit = parseFormPositiveInteger(limit, 12);
  const parsedDepth = parseFormPositiveInteger(depth, 3);

  if (command === "tree") {
    return client.treeKnowledgeFs({
      depth: parsedDepth,
      knowledgeSpaceId: activeWorkspaceId,
      limit: parsedLimit,
      path,
      token,
    });
  }

  if (command === "cat") {
    return client.catKnowledgeFs({
      knowledgeSpaceId: activeWorkspaceId,
      limit: parsedLimit,
      path,
      token,
    });
  }

  if (command === "stat") {
    return client.statKnowledgeFs({
      knowledgeSpaceId: activeWorkspaceId,
      path,
      token,
    });
  }

  if (command === "grep") {
    return client.grepKnowledgeFs({
      knowledgeSpaceId: activeWorkspaceId,
      limit: parsedLimit,
      path,
      q: grepQuery,
      token,
    });
  }

  if (command === "find") {
    return client.findKnowledgeFs({
      knowledgeSpaceId: activeWorkspaceId,
      limit: parsedLimit,
      path,
      ...(findMetadataKey ? { metadataKey: findMetadataKey } : {}),
      ...(findMetadataValue ? { metadataValue: findMetadataValue } : {}),
      ...(findNameContains ? { nameContains: findNameContains } : {}),
      ...(findResourceType
        ? { resourceType: findResourceType as AdminKnowledgeFsEntry["resourceType"] }
        : {}),
      token,
    });
  }

  if (command === "diff") {
    return client.diffKnowledgeFs({
      knowledgeSpaceId: activeWorkspaceId,
      mode: "word",
      newPath,
      oldPath,
      semantic: true,
      token,
    });
  }

  if (command === "open_node") {
    return client.openKnowledgeFsNode({
      knowledgeSpaceId: activeWorkspaceId,
      nodeId,
      token,
    });
  }

  return client.listKnowledgeFs({
    knowledgeSpaceId: activeWorkspaceId,
    limit: parsedLimit,
    path,
    token,
  });
}

function emptyLive<T>(): Promise<Loaded<T>> {
  return Promise.resolve({});
}

function visibleLiveDataError(error: string | undefined): string | undefined {
  if (!error?.includes("Answer trace not found")) {
    return error;
  }

  return undefined;
}

async function loadLive<T>(label: string, task: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { value: await task() };
  } catch (error) {
    return {
      error: `${label}: ${error instanceof Error ? error.message : "failed"}`,
    };
  }
}

async function loadDocumentPublishReadiness({
  client,
  knowledgeSpaceId,
  searchParams,
  token,
  uploadResult,
}: {
  readonly client: ReturnType<typeof createAdminApiClient>;
  readonly knowledgeSpaceId: string;
  readonly searchParams: Record<string, string | string[] | undefined>;
  readonly token: string;
  readonly uploadResult: AdminUploadResult | null;
}): Promise<AdminPublishReadiness> {
  const requestedDocumentId =
    firstSearchParam(searchParams.documentId) ||
    (uploadResult?.status === "success" ? uploadResult.documentId : undefined);
  const asset = requestedDocumentId
    ? await client.getDocument({
        documentId: requestedDocumentId,
        knowledgeSpaceId,
        token,
      })
    : (await client.listDocuments({ knowledgeSpaceId, limit: 1, token })).items[0];

  if (!asset) {
    return createPublishReadiness(uploadResult);
  }

  const artifact =
    asset.parserStatus === "parsed"
      ? await client
          .getParseArtifact({
            documentId: asset.id,
            knowledgeSpaceId,
            token,
            version: asset.version,
          })
          .catch(() => undefined)
      : undefined;

  return createPublishReadinessFromDocument({ artifact, asset });
}

function selectActiveWorkspace(
  workspaceOptions: readonly AdminWorkspaceOption[],
  searchParams: Record<string, string | string[] | undefined>,
  uploadResult: AdminUploadResult | null,
): AdminWorkspaceOption {
  const resolved = workspaceOptions.length > 0 ? workspaceOptions : [fallbackWorkspaceOption];
  const requestedId =
    firstSearchParam(searchParams.spaceId) ||
    (uploadResult?.status === "success" ? uploadResult.spaceId : undefined);

  return (
    resolved.find((workspace) => workspace.id === requestedId) ??
    resolved.find((workspace) => workspace.slug === "workspace") ??
    resolved[0] ??
    fallbackWorkspaceOption
  );
}

function createRetrievalResult(queryResult: AdminQueryResult | null): {
  readonly answer: string;
  readonly citations: string;
  readonly confidence: string;
  readonly freshness: string;
  readonly query: string;
  readonly subtitle: string;
  readonly traceId?: string | undefined;
} {
  if (queryResult?.status === "success") {
    return {
      answer: queryResult.answer,
      citations: queryResult.citations.length > 0 ? queryResult.citations.join(", ") : "None",
      confidence: queryResult.confidence,
      freshness: queryResult.freshness,
      query: queryResult.query,
      subtitle: "Latest query result",
      ...(queryResult.traceId ? { traceId: queryResult.traceId } : {}),
    };
  }

  if (queryResult?.status === "error") {
    return {
      answer: "Query did not complete.",
      citations: "None",
      confidence: "Unavailable",
      freshness: "Unavailable",
      query: "",
      subtitle: "Latest query failed",
    };
  }

  return {
    answer: "No query has been run in this Admin session.",
    citations: "None",
    confidence: "Unavailable",
    freshness: "Unavailable",
    query: "",
    subtitle: "No live query yet",
  };
}

function createHealthItems(health: AdminHealthStatus | null): readonly AdminHealthMetric[] {
  if (!health) {
    return [
      unavailableHealthMetric("Gateway"),
      unavailableHealthMetric("Database"),
      unavailableHealthMetric("Object store"),
      unavailableHealthMetric("Parser"),
      unavailableHealthMetric("Reranker"),
    ];
  }

  return [
    {
      badge: formatRuntime(health.runtime),
      label: "Gateway",
      status: health.ok ? "ok" : "warn",
      value: health.ok ? "Online" : "Degraded",
    },
    componentMetric({
      healthy: health.components.database,
      label: "Database",
      okValue: "Indexed",
    }),
    componentMetric({
      healthy: health.components.objectStorage,
      label: "Object store",
      okValue: "Writable",
    }),
    componentMetric({
      healthy: health.components.parser,
      label: "Parser",
      okValue: "Ready",
    }),
    componentMetric({
      fallbackValue: "Fallback",
      healthy: health.components.reranker,
      label: "Reranker",
      okValue: "Ready",
      warnWhenUnhealthy: true,
    }),
  ];
}

function createPublishReadiness(uploadResult: AdminUploadResult | null): AdminPublishReadiness {
  if (!uploadResult) {
    return {
      badge: "unavailable",
      elementCount: "Unavailable",
      fileSize: "Unavailable",
      nodeCount: "Unavailable",
      parserStatus: "No document selected",
      qualityRisks: "Upload a document to inspect readiness",
      status: "warn",
      subtitle: "No live document selected",
    };
  }

  if (uploadResult.status === "error") {
    return {
      badge: "failed",
      elementCount: "Unavailable",
      fileSize: "Unavailable",
      nodeCount: "Unavailable",
      parserStatus: "Upload failed",
      qualityRisks: uploadResult.error,
      status: "fail",
      subtitle: "Latest upload",
    };
  }

  return {
    badge: uploadResult.parserStatus === "parsed" ? "ready" : uploadResult.parserStatus,
    elementCount: "Open parse artifact",
    fileSize: formatBytes(uploadResult.sizeBytes),
    nodeCount: "Open document status",
    parserStatus: uploadResult.parserStatus,
    qualityRisks: uploadResult.parserStatus === "failed" ? "Parser reported failure" : "None",
    status:
      uploadResult.parserStatus === "parsed"
        ? "ready"
        : uploadResult.parserStatus === "failed"
          ? "fail"
          : "review",
    subtitle: "Latest upload",
  };
}

function createPublishReadinessFromDocument({
  artifact,
  asset,
}: {
  readonly artifact?: AdminParseArtifact | undefined;
  readonly asset: AdminDocumentAsset;
}): AdminPublishReadiness {
  const report = createDocumentHealthReport({
    ...(artifact ? { artifact } : {}),
    asset,
    nodeCount: artifact?.elements.length ?? 0,
  });
  const qualityRisks = report.qualityRisks.length > 0 ? report.qualityRisks.join("; ") : "None";

  return {
    badge: report.publishReadiness,
    elementCount: artifact ? String(report.elementCount) : "Parse artifact unavailable",
    fileSize: report.sizeLabel,
    nodeCount: artifact
      ? String(report.nodeCount)
      : asset.parserStatus === "pending"
        ? "Pending"
        : "Unavailable",
    parserStatus: report.parserStatus,
    qualityRisks,
    status:
      report.publishReadiness === "ready"
        ? "ready"
        : report.publishReadiness === "blocked"
          ? "fail"
          : "review",
    subtitle: `Latest document: ${report.documentName}`,
  };
}

function createEvaluationStats(list: AdminGoldenQuestionList | undefined): {
  readonly annotated: number;
  readonly badCases: number;
  readonly pending: number;
  readonly total: number;
} {
  const items = list?.items ?? [];
  const annotated = items.filter(
    (item) => item.tags.includes("annotated") || item.metadata.annotation !== undefined,
  ).length;
  const badCases = items.filter(
    (item) =>
      item.tags.includes("production-bad-case") || item.metadata.source === "production-bad-case",
  ).length;

  return {
    annotated,
    badCases,
    pending: Math.max(0, items.length - annotated),
    total: items.length,
  };
}

function createSemanticViewStatus(liveData: AdminLiveData): {
  readonly badge: string;
  readonly badgeStatus: "fail" | "ok" | "warn";
  readonly description: string;
} {
  if (!liveData.topicView && !liveData.entityView && !liveData.communityView) {
    return {
      badge: "Unavailable",
      badgeStatus: "fail",
      description: "Semantic views could not be loaded from KnowledgeFS",
    };
  }

  const topicCount = liveData.topicView?.items.length ?? 0;
  const entityCount = liveData.entityView?.items.length ?? 0;
  const communityCount = liveData.communityView?.items.length ?? 0;

  if (topicCount === 0 && entityCount === 0 && communityCount === 0) {
    return {
      badge: "Not materialized",
      badgeStatus: "warn",
      description: "KnowledgeFS is reachable, but semantic materialization has no entries yet",
    };
  }

  return {
    badge: "Live",
    badgeStatus: "ok",
    description: "Live topic, entity, and community views from KnowledgeFS",
  };
}

function componentMetric({
  fallbackValue = "Unavailable",
  healthy,
  label,
  okValue,
  warnWhenUnhealthy = false,
}: {
  readonly fallbackValue?: string;
  readonly healthy: boolean | undefined;
  readonly label: string;
  readonly okValue: string;
  readonly warnWhenUnhealthy?: boolean;
}): AdminHealthMetric {
  if (healthy === true) {
    return {
      badge: "ok",
      label,
      status: "ok",
      value: okValue,
    };
  }

  return {
    badge: warnWhenUnhealthy ? "warn" : "fail",
    label,
    status: warnWhenUnhealthy ? "warn" : "fail",
    value: fallbackValue,
  };
}

function unavailableHealthMetric(label: string): AdminHealthMetric {
  return {
    badge: "fail",
    label,
    status: "fail",
    value: "Unavailable",
  };
}

function formatRuntime(runtime: AdminHealthStatus["runtime"]): string {
  return runtime === "node-docker" ? "Node Docker" : "Cloudflare";
}

function formatStatusNumber(
  record: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? String(value) : "Unavailable";
}

function formatFsckSummary(
  report: AdminKnowledgeFsckReport | undefined,
  key: "error" | "repairable" | "scanned" | "warning",
): string {
  const value = report?.summary[key];

  return typeof value === "number" && Number.isFinite(value) ? String(value) : "Unavailable";
}

function formatGcSummary(
  report: AdminKnowledgeFsGcDryRunReport | undefined,
  key: "candidateCount" | "estimatedBytes",
): string {
  const value = report?.summary[key];

  return typeof value === "number" && Number.isFinite(value) ? String(value) : "Unavailable";
}

function shortId(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function parseKnowledgeFsCommand(value: string | undefined): AdminKnowledgeFsCommand {
  return knowledgeFsCommands.find((command) => command === value) ?? "ls";
}

function parseFormPositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatJson(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value);
}

function metadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function metadataNumber(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function titleizeSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatTopicKind(kind: AdminKnowledgeFsEntry["kind"]): string {
  return kind === "directory" ? "Document collection" : "Document";
}

function formatEntityType(value: string): string {
  return titleizeSlug(value.toLocaleLowerCase());
}

function formatEntryCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatOptionalCounts(values: readonly (string | undefined)[]): string {
  const formatted = values.filter((value): value is string => Boolean(value));

  return formatted.length > 0 ? formatted.join(" / ") : "directory";
}

function isReadableSemanticEntityEntry(entry: AdminKnowledgeFsEntry): boolean {
  const type = metadataString(entry.metadata, "type");
  if (type === "date") {
    return /^(?:19|20)\d{2}(?:-\d{2}-\d{2})?$/.test(entry.name);
  }

  if (type === "metric") {
    return !isBareNumber(entry.name);
  }

  return !isBareNumber(entry.name);
}

function isBareNumber(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value.trim());
}

function fsckIssueKey(issue: AdminKnowledgeFsckReport["issues"][number], index: number): string {
  const targetKey = [
    issue.target.id,
    issue.target.objectKey,
    issue.target.documentAssetId,
    issue.target.parseArtifactId,
    issue.target.virtualPath,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(":");

  return `${issue.type}:${issue.code}:${targetKey}:${index}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function loadAdminHealth(): Promise<AdminHealthStatus | null> {
  try {
    const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
    return await client.health();
  } catch {
    return null;
  }
}

async function loadAdminWorkspaceOptions(): Promise<AdminWorkspaceOption[]> {
  const token = getAdminServerToken();
  if (!token) {
    return [];
  }

  try {
    const client = createAdminApiClient({ baseUrl: getAdminApiBase() });
    const result = await client.listKnowledgeSpaces({ limit: 100, token });

    return result.items.map(toWorkspaceOption);
  } catch {
    return [];
  }
}

function parseUploadResult(
  searchParams: Record<string, string | string[] | undefined>,
): AdminUploadResult | null {
  const status = firstSearchParam(searchParams.uploadStatus);
  if (status === "error") {
    return {
      error: firstSearchParam(searchParams.uploadError) ?? "Document upload failed",
      status: "error",
    };
  }

  if (status !== "success") {
    return null;
  }

  const documentId = firstSearchParam(searchParams.documentId);
  const filename = firstSearchParam(searchParams.filename);
  const parserStatus = firstSearchParam(searchParams.parserStatus);
  const sha256 = firstSearchParam(searchParams.sha256);
  const sizeBytes = Number(firstSearchParam(searchParams.sizeBytes));
  const spaceId = firstSearchParam(searchParams.spaceId);
  const version = Number(firstSearchParam(searchParams.version));

  if (
    !documentId ||
    !filename ||
    !spaceId ||
    !sha256 ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes < 0 ||
    !Number.isInteger(version) ||
    version < 1 ||
    (parserStatus !== "pending" && parserStatus !== "parsed" && parserStatus !== "failed")
  ) {
    return {
      error: "Document upload response is invalid",
      status: "error",
    };
  }

  return {
    documentId,
    filename,
    parserStatus,
    sha256,
    sizeBytes,
    spaceId,
    status: "success",
    version,
  };
}

function parseQueryResult(
  searchParams: Record<string, string | string[] | undefined>,
): AdminQueryResult | null {
  const status = firstSearchParam(searchParams.queryStatus);
  if (status === "error") {
    return {
      error: firstSearchParam(searchParams.queryError) ?? "Query failed",
      status: "error",
    };
  }

  if (status !== "success") {
    return null;
  }

  const answer = firstSearchParam(searchParams.answer);
  const query = firstSearchParam(searchParams.query);
  if (!answer || !query) {
    return {
      error: "Query response is invalid",
      status: "error",
    };
  }

  return {
    answer,
    citations: splitCsv(firstSearchParam(searchParams.citations) ?? ""),
    confidence: firstSearchParam(searchParams.confidence) ?? "Generated",
    freshness: firstSearchParam(searchParams.freshness) ?? "Live query",
    query,
    status: "success",
    ...(firstSearchParam(searchParams.traceId)
      ? { traceId: firstSearchParam(searchParams.traceId) }
      : {}),
  };
}

function parseAdminNotice(
  searchParams: Record<string, string | string[] | undefined>,
): AdminNotice | undefined {
  const status = firstSearchParam(searchParams.adminStatus);
  const message = firstSearchParam(searchParams.adminMessage);

  if ((status !== "error" && status !== "success") || !message) {
    return undefined;
  }

  return { message, status };
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toWorkspaceOption(space: AdminKnowledgeSpace): AdminWorkspaceOption {
  return {
    id: space.id,
    name: space.name,
    slug: space.slug,
  };
}
