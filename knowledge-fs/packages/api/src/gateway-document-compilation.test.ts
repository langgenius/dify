import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import {
  type DifyCapabilityV2GatewayAuthenticator,
  type DifyCapabilityV2SanitizedGrant,
  createDocumentCompilationJobStateMachine,
  createInMemoryDocumentAssetRepository,
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

  it("authorizes status and cancellation from an exact child job Capability", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
    const jobId = "document-compilation-job-capability";
    const assets = createInMemoryDocumentAssetRepository({
      generateId: () => documentAssetId,
      maxAssets: 2,
    });
    await assets.create({
      filename: "Capability.md",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      metadata: { permissionScope: ["scope-a"] },
      mimeType: "text/markdown",
      objectKey: "tenant-1/capability.md",
      sha256: "0".repeat(64),
      sizeBytes: 1,
    });
    const compilationJobs = createDocumentCompilationJobStateMachine({
      generateId: () => jobId,
      jobs: adapter.jobs,
      repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 2 }),
    });
    await compilationJobs.start({
      capabilityGrantId: "20000000-0000-4000-8000-000000000001",
      documentAssetId,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      tenantId: "tenant-1",
      version: 1,
    });

    let activeGrant = compilationJobGrant(jobId, "document_jobs.read");
    const authenticate = vi.fn<DifyCapabilityV2GatewayAuthenticator["authenticate"]>(async () =>
      capabilityPrincipal(activeGrant),
    );
    const app = createKnowledgeGateway({
      adapter,
      difyCapabilityV2Auth: { authenticate },
      documentAssets: assets,
      documentCompilationJobs: compilationJobs,
    });
    const jobUrl = `/jobs/${jobId}?knowledgeSpaceId=018f0d60-7a49-7cc2-9c1b-5b36f18f2c42`;

    const status = await app.request(jobUrl, {
      headers: { authorization: "Bearer capability-token" },
    });
    expect(status.status).toBe(200);
    expect(await status.text()).not.toContain("capabilityGrantId");

    activeGrant = compilationJobGrant(jobId, "document_jobs.read", {
      parentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
    });
    const wrongParent = await app.request(jobUrl, {
      headers: { authorization: "Bearer capability-token" },
    });
    expect(wrongParent.status).toBe(404);

    activeGrant = compilationJobGrant(jobId, "document_jobs.cancel");
    const canceled = await app.request(jobUrl, {
      headers: { authorization: "Bearer capability-token" },
      method: "DELETE",
    });
    expect(canceled.status).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({ id: jobId, stage: "canceled" });
  });
});

function compilationJobGrant(
  jobId: string,
  action: "document_jobs.cancel" | "document_jobs.read",
  { parentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42" }: { readonly parentId?: string } = {},
): DifyCapabilityV2SanitizedGrant {
  return {
    action,
    actor: "dify-account:user-1",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "dify-console",
    callerKind: "interactive",
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: ["scope-a"],
    controlSpaceId: "control-space-1",
    expiresAt: 2_000_000_060,
    grantId: `document-job-grant:${action}:${parentId}`,
    issuedAt: 2_000_000_000,
    jtiHash: `sha256:${"0".repeat(64)}`,
    namespaceId: "tenant-1",
    notBefore: 2_000_000_000,
    resource: { id: jobId, parent_id: parentId, type: "job" },
    subject: "dify-account:user-1",
    traceId: "trace-1",
  };
}

function capabilityPrincipal(grant: DifyCapabilityV2SanitizedGrant) {
  return {
    callerKind: grant.callerKind,
    claims: {
      action: grant.action,
      actor: grant.actor,
      aud: "knowledge-fs",
      authz_revision: grant.authzRevision,
      azp: grant.azp,
      caller_kind: grant.callerKind,
      cap_ver: grant.capVersion,
      content_policy_revision: grant.contentPolicyRevision,
      content_scope_ids: [...grant.contentScopeIds],
      control_space_id: grant.controlSpaceId,
      exp: grant.expiresAt,
      grant_id: grant.grantId,
      iat: grant.issuedAt,
      iss: "dify-control-plane",
      jti: "test-jti",
      namespace_id: grant.namespaceId,
      nbf: grant.notBefore,
      resource: grant.resource,
      sub: grant.subject,
      trace_id: grant.traceId,
    },
    grant,
    subject: {
      scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
      subjectId: grant.subject,
      tenantId: grant.namespaceId,
    },
  };
}
