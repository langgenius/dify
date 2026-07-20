import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  createDocumentCompilationJobStateMachine,
  createInMemoryDocumentCompilationJobRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryLogicalDocumentRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const writeOnlyToken = "write-only-token";
const otherTenantToken = "other-tenant-token";

const readSubject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};
const writeSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};
const writeOnlySubject = {
  scopes: ["knowledge-spaces:write"],
  subjectId: "user-3",
  tenantId: "tenant-1",
};
const otherTenantSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-2",
  tenantId: "tenant-2",
};

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createTestAuthVerifier() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [otherTenantToken]: otherTenantSubject,
      [readToken]: readSubject,
      [writeOnlyToken]: writeOnlySubject,
      [writeToken]: writeSubject,
    },
  });
}

describe("document compilation gateway integration", () => {
  it("protects tenant-scoped document compilation job status and cancellation APIs", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => "document-compilation-job-1",
      jobs: adapter.jobs,
      now: () => 1_777_777_000_000,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 10 }),
    });
    const app = createKnowledgeGateway({
      adapter,
      auth: createTestAuthVerifier(),
      documentCompilationJobs: compilationJobs,
      generateDocumentAssetId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      logicalDocuments: createInMemoryLogicalDocumentRepository({
        canReadDocument: ({ candidateGrants }) => candidateGrants.includes("tenant:tenant-1"),
        canReadRevision: ({ candidateGrants }) => candidateGrants.includes("tenant:tenant-1"),
        generateDocumentId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        maxDocuments: 10,
        maxRevisionsPerDocument: 10,
      }),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-09T10:00:00.000Z",
      }),
    });

    await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Uploads", slug: "uploads" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "Job.md", { type: "text/markdown" }));
    const upload = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42/documents",
      {
        body: form,
        headers: bearer(writeToken),
        method: "POST",
      },
    );
    expect(upload.status).toBe(202);

    const status = await app.request("/jobs/document-compilation-job-1", {
      headers: bearer(readToken),
    });
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      id: "document-compilation-job-1",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      stage: "queued",
      tenantId: "tenant-1",
      version: 1,
    });
    expect(
      await (
        await app.request("/jobs/document-compilation-job-1", {
          headers: bearer(readToken),
        })
      ).text(),
    ).not.toContain("requestedBySubjectId");

    const writeOnlyStatus = await app.request("/jobs/document-compilation-job-1", {
      headers: bearer(writeOnlyToken),
    });
    expect(writeOnlyStatus.status).toBe(403);

    const crossTenantStatus = await app.request("/jobs/document-compilation-job-1", {
      headers: bearer(otherTenantToken),
    });
    expect(crossTenantStatus.status).toBe(404);

    const readOnlyRetry = await app.request("/jobs/document-compilation-job-1/retry", {
      headers: bearer(readToken),
      method: "POST",
    });
    expect(readOnlyRetry.status).toBe(403);

    const unsupportedLegacyRetry = await app.request("/jobs/document-compilation-job-1/retry", {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(unsupportedLegacyRetry.status).toBe(409);

    const readOnlyCancel = await app.request("/jobs/document-compilation-job-1", {
      headers: bearer(readToken),
      method: "DELETE",
    });
    expect(readOnlyCancel.status).toBe(403);

    const cancel = await app.request("/jobs/document-compilation-job-1", {
      headers: bearer(writeToken),
      method: "DELETE",
    });
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toMatchObject({
      id: "document-compilation-job-1",
      stage: "canceled",
    });
    await expect(adapter.jobs.status("job-1")).resolves.toMatchObject({
      status: "canceled",
    });
  });
});
