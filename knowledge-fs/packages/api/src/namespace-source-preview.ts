import { createHash, randomUUID } from "node:crypto";

import type {
  AuthSubject,
  DatabaseAdapter,
  DatabaseQueryValue,
  ObjectStorageAdapter,
  Source,
} from "@knowledge/core";

import { optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import type { SourceProductWorkflowService } from "./source-product-workflow";
import type { SourceRepository } from "./source-repository";
import type { WebsiteCrawlConnector } from "./website-crawl-connector";

export type NamespaceSourcePreviewStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "consumed";

export interface NamespaceSourcePreviewConfig {
  readonly credentialId: string;
  readonly datasource: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly pluginId: string;
  readonly provider: string;
  readonly rootUrl: string;
}

export interface NamespaceSourcePreviewPage {
  readonly contentHash: string;
  readonly contentObjectKey: string;
  readonly description?: string | undefined;
  readonly pageId: string;
  readonly sourceUrl: string;
  readonly title?: string | undefined;
}

export interface NamespaceSourcePreviewJob {
  readonly accountId: string;
  readonly configurationFingerprint: string;
  readonly config: NamespaceSourcePreviewConfig;
  readonly consumedAt?: string | undefined;
  readonly contentCleanedAt?: string | undefined;
  readonly createdAt: string;
  readonly errorCode?: string | undefined;
  readonly expiresAt: string;
  readonly id: string;
  readonly importWorkflowId?: string | undefined;
  readonly status: NamespaceSourcePreviewStatus;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface NamespaceSourcePreviewRepository {
  create(job: NamespaceSourcePreviewJob): Promise<void>;
  get(input: {
    tenantId: string;
    accountId: string;
    jobId: string;
  }): Promise<NamespaceSourcePreviewJob | null>;
  listPages(jobId: string): Promise<NamespaceSourcePreviewPage[]>;
  expire(now: string): Promise<readonly NamespaceSourcePreviewPage[]>;
  claim(now: string): Promise<NamespaceSourcePreviewJob | null>;
  complete(input: {
    jobId: string;
    now: string;
    pages: readonly NamespaceSourcePreviewPage[];
  }): Promise<boolean>;
  fail(input: { jobId: string; now: string; errorCode: string }): Promise<void>;
  cancel(input: {
    tenantId: string;
    accountId: string;
    jobId: string;
    now: string;
  }): Promise<boolean>;
  consume(input: { jobId: string; now: string; workflowId: string }): Promise<void>;
  claimCleanup(): Promise<NamespaceSourcePreviewJob | null>;
  completeCleanup(input: { jobId: string; now: string }): Promise<void>;
}

export class NamespaceSourcePreviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NamespaceSourcePreviewError";
  }
}

const jobsTable = "namespace_source_preview_jobs";
const pagesTable = "namespace_source_preview_pages";

export function createInMemoryNamespaceSourcePreviewRepository(): NamespaceSourcePreviewRepository {
  const jobs = new Map<string, NamespaceSourcePreviewJob>();
  const pages = new Map<string, NamespaceSourcePreviewPage[]>();
  return {
    create: async (job) => {
      jobs.set(job.id, job);
    },
    get: async ({ tenantId, accountId, jobId }) => {
      const job = jobs.get(jobId);
      return job?.tenantId === tenantId && job.accountId === accountId ? job : null;
    },
    listPages: async (jobId) => [...(pages.get(jobId) ?? [])],
    expire: async (now) => {
      const job = [...jobs.values()].find(
        (candidate) =>
          ["queued", "running", "completed"].includes(candidate.status) &&
          candidate.expiresAt <= now,
      );
      if (!job) return [];
      jobs.set(job.id, { ...job, status: "failed", errorCode: "PREVIEW_EXPIRED", updatedAt: now });
      return [...(pages.get(job.id) ?? [])];
    },
    claim: async (now) => {
      const job = [...jobs.values()]
        .filter((j) => j.status === "queued" && j.expiresAt > now)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!job) return null;
      const claimed = { ...job, status: "running" as const, updatedAt: now };
      jobs.set(job.id, claimed);
      return claimed;
    },
    complete: async ({ jobId, now, pages: items }) => {
      const job = jobs.get(jobId);
      if (job?.status !== "running") return false;
      pages.set(jobId, [...items]);
      jobs.set(jobId, { ...job, status: "completed", updatedAt: now });
      return true;
    },
    fail: async ({ jobId, now, errorCode }) => {
      const job = jobs.get(jobId);
      if (job) jobs.set(jobId, { ...job, status: "failed", updatedAt: now, errorCode });
    },
    cancel: async ({ tenantId, accountId, jobId, now }) => {
      const job = jobs.get(jobId);
      if (!job || job.tenantId !== tenantId || job.accountId !== accountId) return false;
      jobs.set(jobId, { ...job, status: "canceled", updatedAt: now });
      return true;
    },
    consume: async ({ jobId, now, workflowId }) => {
      const job = jobs.get(jobId);
      if (job)
        jobs.set(jobId, {
          ...job,
          status: "consumed",
          updatedAt: now,
          consumedAt: now,
          importWorkflowId: workflowId,
        });
    },
    claimCleanup: async () =>
      [...jobs.values()].find(
        (job) => ["failed", "canceled", "consumed"].includes(job.status) && !job.contentCleanedAt,
      ) ?? null,
    completeCleanup: async ({ jobId, now }) => {
      const job = jobs.get(jobId);
      if (job) jobs.set(jobId, { ...job, contentCleanedAt: now });
    },
  };
}

export function createDatabaseNamespaceSourcePreviewRepository(input: {
  database: DatabaseAdapter;
}): NamespaceSourcePreviewRepository {
  const db = input.database;
  const q = (name: string) => quoteDatabaseIdentifier(db, name);
  const ph = (n: number) => databasePlaceholder(db, n);
  return {
    create: async (job) => {
      await db.execute({
        operation: "insert",
        tableName: jobsTable,
        maxRows: 0,
        params: [
          job.id,
          job.tenantId,
          job.accountId,
          job.status,
          JSON.stringify(job.config),
          job.configurationFingerprint,
          job.expiresAt,
          job.createdAt,
          job.updatedAt,
        ],
        sql: `INSERT INTO ${q(jobsTable)} (${q("id")},${q("tenant_id")},${q("account_id")},${q("status")},${q("provider_config")},${q("configuration_fingerprint")},${q("expires_at")},${q("created_at")},${q("updated_at")}) VALUES (${ph(1)},${ph(2)},${ph(3)},${ph(4)},${jsonInsertPlaceholder(db, 5, "provider_config")},${ph(6)},${ph(7)},${ph(8)},${ph(9)})`,
      });
    },
    get: async ({ tenantId, accountId, jobId }) => {
      const result = await db.execute({
        operation: "select",
        tableName: jobsTable,
        maxRows: 1,
        params: [jobId, tenantId, accountId],
        sql: `SELECT * FROM ${q(jobsTable)} WHERE ${q("id")}=${ph(1)} AND ${q("tenant_id")}=${ph(2)} AND ${q("account_id")}=${ph(3)}`,
      });
      return result.rows[0] ? rowJob(result.rows[0]) : null;
    },
    listPages: async (jobId) =>
      (
        await db.execute({
          operation: "select",
          tableName: pagesTable,
          maxRows: 200,
          params: [jobId],
          sql: `SELECT * FROM ${q(pagesTable)} WHERE ${q("job_id")}=${ph(1)} ORDER BY ${q("created_at")},${q("page_id")}`,
        })
      ).rows.map(rowPage),
    expire: async (now) =>
      db.transaction(async (tx) => {
        const found = await tx.execute({
          operation: "select",
          tableName: jobsTable,
          maxRows: 1,
          params: [now],
          sql: `SELECT ${q("id")} FROM ${q(jobsTable)} WHERE ${q("status")} IN ('queued','running','completed') AND ${q("expires_at")}<=${ph(1)} ORDER BY ${q("expires_at")} LIMIT 1 FOR UPDATE`,
        });
        const jobId = found.rows[0] ? stringColumn(found.rows[0], "id") : undefined;
        if (!jobId) return [];
        const expiredPages = await tx.execute({
          operation: "select",
          tableName: pagesTable,
          maxRows: 200,
          params: [jobId],
          sql: `SELECT * FROM ${q(pagesTable)} WHERE ${q("job_id")}=${ph(1)}`,
        });
        await tx.execute({
          operation: "update",
          tableName: jobsTable,
          maxRows: 0,
          params: [now, jobId],
          sql: `UPDATE ${q(jobsTable)} SET ${q("status")}='failed',${q("error_code")}='PREVIEW_EXPIRED',${q("updated_at")}=${ph(1)} WHERE ${q("id")}=${ph(2)}`,
        });
        return expiredPages.rows.map(rowPage);
      }),
    claim: async (now) =>
      db.transaction(async (tx) => {
        const found = await tx.execute({
          operation: "select",
          tableName: jobsTable,
          maxRows: 1,
          params: [now],
          sql: `SELECT * FROM ${q(jobsTable)} WHERE ${q("status")}='queued' AND ${q("expires_at")}>${ph(1)} ORDER BY ${q("created_at")} LIMIT 1 FOR UPDATE`,
        });
        if (!found.rows[0]) return null;
        const job = rowJob(found.rows[0]);
        const updated = await tx.execute({
          operation: "update",
          tableName: jobsTable,
          maxRows: 0,
          params: [now, job.id],
          sql: `UPDATE ${q(jobsTable)} SET ${q("status")}='running',${q("updated_at")}=${ph(1)} WHERE ${q("id")}=${ph(2)} AND ${q("status")}='queued'`,
        });
        return updated.rowsAffected === 1 ? { ...job, status: "running", updatedAt: now } : null;
      }),
    complete: async ({ jobId, now, pages }) =>
      db.transaction(async (tx) => {
        for (const page of pages)
          await tx.execute({
            operation: "insert",
            tableName: pagesTable,
            maxRows: 0,
            params: [
              jobId,
              page.pageId,
              page.sourceUrl,
              page.title ?? null,
              page.description ?? null,
              page.contentHash,
              page.contentObjectKey,
              now,
            ],
            sql: `INSERT INTO ${q(pagesTable)} (${q("job_id")},${q("page_id")},${q("source_url")},${q("title")},${q("description")},${q("content_hash")},${q("content_object_key")},${q("created_at")}) VALUES (${[1, 2, 3, 4, 5, 6, 7, 8].map(ph).join(",")})`,
          });
        const completed = await tx.execute({
          operation: "update",
          tableName: jobsTable,
          maxRows: 0,
          params: [now, jobId],
          sql: `UPDATE ${q(jobsTable)} SET ${q("status")}='completed',${q("updated_at")}=${ph(1)} WHERE ${q("id")}=${ph(2)} AND ${q("status")}='running'`,
        });
        return completed.rowsAffected === 1;
      }),
    fail: async ({ jobId, now, errorCode }) => {
      await db.execute({
        operation: "update",
        tableName: jobsTable,
        maxRows: 0,
        params: [errorCode, now, jobId],
        sql: `UPDATE ${q(jobsTable)} SET ${q("status")}='failed',${q("error_code")}=${ph(1)},${q("updated_at")}=${ph(2)} WHERE ${q("id")}=${ph(3)} AND ${q("status")} IN ('queued','running')`,
      });
    },
    cancel: async ({ tenantId, accountId, jobId, now }) =>
      (
        await db.execute({
          operation: "update",
          tableName: jobsTable,
          maxRows: 0,
          params: [now, jobId, tenantId, accountId],
          sql: `UPDATE ${q(jobsTable)} SET ${q("status")}='canceled',${q("updated_at")}=${ph(1)} WHERE ${q("id")}=${ph(2)} AND ${q("tenant_id")}=${ph(3)} AND ${q("account_id")}=${ph(4)} AND ${q("status")} IN ('queued','running','completed')`,
        })
      ).rowsAffected === 1,
    consume: async ({ jobId, now, workflowId }) => {
      await db.execute({
        operation: "update",
        tableName: jobsTable,
        maxRows: 0,
        params: [workflowId, now, now, jobId],
        sql: `UPDATE ${q(jobsTable)} SET ${q("status")}='consumed',${q("import_workflow_id")}=${ph(1)},${q("consumed_at")}=${ph(2)},${q("updated_at")}=${ph(3)} WHERE ${q("id")}=${ph(4)} AND ${q("status")}='completed'`,
      });
    },
    claimCleanup: async () => {
      const result = await db.execute({
        operation: "select",
        tableName: jobsTable,
        maxRows: 1,
        params: [],
        sql: `SELECT * FROM ${q(jobsTable)} WHERE ${q("status")} IN ('failed','canceled','consumed') AND ${q("content_cleaned_at")} IS NULL ORDER BY ${q("updated_at")} LIMIT 1`,
      });
      return result.rows[0] ? rowJob(result.rows[0]) : null;
    },
    completeCleanup: async ({ jobId, now }) => {
      await db.execute({
        operation: "update",
        tableName: jobsTable,
        maxRows: 0,
        params: [now, jobId],
        sql: `UPDATE ${q(jobsTable)} SET ${q("content_cleaned_at")}=${ph(1)} WHERE ${q("id")}=${ph(2)} AND ${q("status")} IN ('failed','canceled','consumed')`,
      });
    },
  };
}

function rowJob(row: Readonly<Record<string, unknown>>): NamespaceSourcePreviewJob {
  const configRaw = row.provider_config;
  const config = (
    typeof configRaw === "string" ? JSON.parse(configRaw) : configRaw
  ) as NamespaceSourcePreviewConfig;
  return {
    id: stringColumn(row, "id"),
    tenantId: stringColumn(row, "tenant_id"),
    accountId: stringColumn(row, "account_id"),
    status: stringColumn(row, "status") as NamespaceSourcePreviewStatus,
    config,
    configurationFingerprint: stringColumn(row, "configuration_fingerprint"),
    expiresAt: stringColumn(row, "expires_at"),
    createdAt: stringColumn(row, "created_at"),
    updatedAt: stringColumn(row, "updated_at"),
    ...(optionalStringColumn(row, "consumed_at")
      ? { consumedAt: optionalStringColumn(row, "consumed_at") }
      : {}),
    ...(optionalStringColumn(row, "content_cleaned_at")
      ? { contentCleanedAt: optionalStringColumn(row, "content_cleaned_at") }
      : {}),
    ...(optionalStringColumn(row, "error_code")
      ? { errorCode: optionalStringColumn(row, "error_code") }
      : {}),
    ...(optionalStringColumn(row, "import_workflow_id")
      ? { importWorkflowId: optionalStringColumn(row, "import_workflow_id") }
      : {}),
  };
}
function rowPage(row: Readonly<Record<string, unknown>>): NamespaceSourcePreviewPage {
  return {
    pageId: stringColumn(row, "page_id"),
    sourceUrl: stringColumn(row, "source_url"),
    contentHash: stringColumn(row, "content_hash"),
    contentObjectKey: stringColumn(row, "content_object_key"),
    ...(optionalStringColumn(row, "title") ? { title: optionalStringColumn(row, "title") } : {}),
    ...(optionalStringColumn(row, "description")
      ? { description: optionalStringColumn(row, "description") }
      : {}),
  };
}

export function createNamespaceSourcePreviewService(input: {
  repository: NamespaceSourcePreviewRepository;
  storage: ObjectStorageAdapter;
  websiteCrawl: WebsiteCrawlConnector;
  workflows: SourceProductWorkflowService;
  sources: SourceRepository;
  now?: () => Date;
  maxPageBytes?: number;
  maxJobBytes?: number;
}) {
  const now = input.now ?? (() => new Date());
  const maxPageBytes = input.maxPageBytes ?? 20 * 1024 * 1024;
  const maxJobBytes = input.maxJobBytes ?? 200 * 1024 * 1024;
  if (!Number.isSafeInteger(maxPageBytes) || maxPageBytes < 1)
    throw new Error("Namespace preview maxPageBytes must be a positive safe integer");
  if (!Number.isSafeInteger(maxJobBytes) || maxJobBytes < maxPageBytes)
    throw new Error("Namespace preview maxJobBytes must be a safe integer >= maxPageBytes");
  const objectPrefix = (job: NamespaceSourcePreviewJob) =>
    `__namespace-source-previews/${encodeURIComponent(job.tenantId)}/${job.id}/`;
  const cleanup = async (job: NamespaceSourcePreviewJob) => {
    const prefix = objectPrefix(job);
    for (;;) {
      const result = await input.storage.listObjects({ prefix, limit: 100 });
      for (const object of result.objects) await input.storage.deleteObject(object.key);
      if (result.objects.length === 0) break;
    }
    await input.repository.completeCleanup({ jobId: job.id, now: now().toISOString() });
  };
  const requireJob = async (subject: AuthSubject, jobId: string) => {
    const job = await input.repository.get({
      tenantId: subject.tenantId,
      accountId: subject.subjectId,
      jobId,
    });
    if (!job) throw new NamespaceSourcePreviewError("PREVIEW_NOT_FOUND", "Preview job not found");
    return job;
  };
  return {
    create: async (
      subject: AuthSubject,
      config: NamespaceSourcePreviewConfig,
      fingerprint: string,
    ) => {
      const timestamp = now();
      const job: NamespaceSourcePreviewJob = {
        id: randomUUID(),
        tenantId: subject.tenantId,
        accountId: subject.subjectId,
        status: "queued",
        config,
        configurationFingerprint: fingerprint,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
        expiresAt: new Date(timestamp.getTime() + 60 * 60_000).toISOString(),
      };
      await input.repository.create(job);
      return job;
    },
    get: (subject: AuthSubject, jobId: string) => requireJob(subject, jobId),
    pages: async (subject: AuthSubject, jobId: string) => {
      const job = await requireJob(subject, jobId);
      return job.status === "completed" || job.status === "consumed"
        ? input.repository.listPages(job.id)
        : [];
    },
    cancel: async (subject: AuthSubject, jobId: string) => {
      const job = await requireJob(subject, jobId);
      await input.repository.cancel({
        tenantId: subject.tenantId,
        accountId: subject.subjectId,
        jobId,
        now: now().toISOString(),
      });
      const canceled = await requireJob(subject, jobId);
      await cleanup(canceled);
      return requireJob(subject, jobId);
    },
    tick: async () => {
      const timestamp = now().toISOString();
      await input.repository.expire(timestamp);
      const cleanupJob = await input.repository.claimCleanup();
      if (cleanupJob) {
        await cleanup(cleanupJob).catch(() => {});
        return true;
      }
      const job = await input.repository.claim(timestamp);
      if (!job) return false;
      const source: Source = {
        id: randomUUID(),
        knowledgeSpaceId: "00000000-0000-0000-0000-000000000000",
        name: "Namespace website preview",
        type: "web",
        uri: job.config.rootUrl,
        status: "disabled",
        permissionScope: [],
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        metadata: {
          credentialId: job.config.credentialId,
          datasource: job.config.datasource,
          parameters: job.config.parameters,
          pluginId: job.config.pluginId,
          provider: job.config.provider,
          datasourceParameterMode: "exact",
        },
      };
      const saved: string[] = [];
      try {
        const result = await input.websiteCrawl.crawl({
          source,
          tenantId: job.tenantId,
          userId: job.accountId,
        });
        const pages: NamespaceSourcePreviewPage[] = [];
        let totalBytes = 0;
        for (const page of result.pages) {
          const body = new TextEncoder().encode(page.content);
          if (body.byteLength > maxPageBytes)
            throw new NamespaceSourcePreviewError(
              "PREVIEW_PAGE_TOO_LARGE",
              "Preview page exceeds the per-page content limit",
            );
          if (totalBytes > maxJobBytes - body.byteLength)
            throw new NamespaceSourcePreviewError(
              "PREVIEW_JOB_TOO_LARGE",
              "Preview job exceeds the total content limit",
            );
          totalBytes += body.byteLength;
          const hash = createHash("sha256").update(body).digest("hex");
          const pageId = createHash("sha256").update(page.sourceUrl).digest("hex").slice(0, 32);
          const key = `${objectPrefix(job)}${pageId}-${hash}.bin`;
          await input.storage.putObject({
            key,
            body,
            contentType: "text/markdown",
            metadata: { contentHash: hash, lifecycle: "namespace-source-preview", jobId: job.id },
          });
          saved.push(key);
          pages.push({
            pageId,
            sourceUrl: page.sourceUrl,
            contentHash: hash,
            contentObjectKey: key,
            ...(page.title ? { title: page.title } : {}),
            ...(page.description ? { description: page.description } : {}),
          });
        }
        const completed = await input.repository.complete({
          jobId: job.id,
          now: now().toISOString(),
          pages,
        });
        if (!completed)
          throw new NamespaceSourcePreviewError(
            "PREVIEW_STATE_CONFLICT",
            "Preview job could not be completed from its current state",
          );
      } catch (error) {
        for (const key of saved) await input.storage.deleteObject(key).catch(() => {});
        await input.repository.fail({
          jobId: job.id,
          now: now().toISOString(),
          errorCode:
            error instanceof NamespaceSourcePreviewError ? error.code : "PREVIEW_PROVIDER_FAILED",
        });
        const failed = await input.repository.get({
          tenantId: job.tenantId,
          accountId: job.accountId,
          jobId: job.id,
        });
        if (failed) await cleanup(failed).catch(() => {});
      }
      return true;
    },
    consume: async (
      subject: AuthSubject,
      request: {
        jobId: string;
        pageIds: readonly string[];
        configurationFingerprint: string;
        knowledgeSpaceId: string;
        sourceId: string;
        idempotencyKey: string;
      },
    ) => {
      const job = await requireJob(subject, request.jobId);
      if (job.importWorkflowId) return job.importWorkflowId;
      if (job.expiresAt <= now().toISOString())
        throw new NamespaceSourcePreviewError("PREVIEW_EXPIRED", "Preview job expired");
      if (
        job.status !== "completed" ||
        job.configurationFingerprint !== request.configurationFingerprint
      )
        throw new NamespaceSourcePreviewError(
          "PREVIEW_CONFIGURATION_MISMATCH",
          "Preview configuration changed",
        );
      const source = await input.sources.get({
        knowledgeSpaceId: request.knowledgeSpaceId,
        id: request.sourceId,
      });
      if (
        !source ||
        source.type !== "web" ||
        source.metadata.credentialId !== job.config.credentialId ||
        source.metadata.pluginId !== job.config.pluginId ||
        source.metadata.provider !== job.config.provider ||
        source.metadata.datasource !== job.config.datasource ||
        (source.metadata.initialPreview as { configurationFingerprint?: unknown } | undefined)
          ?.configurationFingerprint !== job.configurationFingerprint
      )
        throw new NamespaceSourcePreviewError(
          "PREVIEW_TARGET_MISMATCH",
          "Preview target source does not match",
        );
      const byId = new Map((await input.repository.listPages(job.id)).map((p) => [p.pageId, p]));
      const selected: NamespaceSourcePreviewPage[] = [];
      for (const pageId of request.pageIds) {
        const page = byId.get(pageId);
        if (!page)
          throw new NamespaceSourcePreviewError("PREVIEW_PAGE_NOT_FOUND", "Preview page not found");
        selected.push(page);
      }
      const pages = await Promise.all(
        selected.map(async (p) => {
          const body = await input.storage.getObject(p.contentObjectKey);
          if (!body)
            throw new NamespaceSourcePreviewError("PREVIEW_EXPIRED", "Preview content expired");
          return {
            sourceUrl: p.sourceUrl,
            content: new TextDecoder().decode(body),
            ...(p.title ? { title: p.title } : {}),
            ...(p.description ? { description: p.description } : {}),
          };
        }),
      );
      const workflow = await input.workflows.createCrawlImport({
        subject,
        callerKind: "interactive",
        knowledgeSpaceId: request.knowledgeSpaceId,
        sourceId: request.sourceId,
        idempotencyKey: request.idempotencyKey,
        sourceUrls: pages.map((p) => p.sourceUrl),
        pages,
      });
      await input.repository.consume({
        jobId: job.id,
        now: now().toISOString(),
        workflowId: workflow.id,
      });
      const consumed = await requireJob(subject, job.id);
      await cleanup(consumed).catch(() => {});
      return workflow.id;
    },
  };
}
