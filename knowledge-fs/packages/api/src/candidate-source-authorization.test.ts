import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createStaticAuthVerifier } from "./auth";
import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED,
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
} from "./candidate-content-authorization";
import { DurableDeletionServiceError } from "./durable-deletion-service";
import {
  createAcceptingDurableDeletionService,
  createAllowingDurableDeletionSafetyOptions,
} from "./durable-deletion-test-utils";
import { createKnowledgeGateway } from "./index";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import { createInMemorySourceRepository } from "./source-repository";

const SPACE_ID = "91000000-0000-4000-8000-000000000001";
const RESTRICTED_SOURCE_ID = "92000000-0000-4000-8000-000000000001";
const OPEN_SOURCE_ID = "92000000-0000-4000-8000-000000000002";
const SECOND_OPEN_SOURCE_ID = "92000000-0000-4000-8000-000000000003";
const OWNER_GRANT = `knowledge-space:${SPACE_ID}:role:owner`;
const EDITOR_GRANT = `knowledge-space:${SPACE_ID}:role:editor`;
const owner = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };
const editor = { scopes: ["knowledge-spaces:*"], subjectId: "editor-1", tenantId: "tenant-1" };

describe("candidate authorization for source routes", () => {
  it("filters lists and returns 404 before every hidden source read or mutation", async () => {
    const fixture = await createFixture();
    await fixture.sources.create({
      id: RESTRICTED_SOURCE_ID,
      knowledgeSpaceId: SPACE_ID,
      metadata: { secretMetadata: "must-not-leak", tenantId: owner.tenantId },
      name: "Restricted connector",
      permissionScope: [OWNER_GRANT],
      type: "connector",
      uri: "secret://restricted",
    });
    await fixture.sources.create({
      id: OPEN_SOURCE_ID,
      knowledgeSpaceId: SPACE_ID,
      metadata: { tenantId: owner.tenantId },
      name: "Open connector",
      permissionScope: [],
      type: "connector",
      uri: "public://open",
    });
    await fixture.sources.create({
      id: SECOND_OPEN_SOURCE_ID,
      knowledgeSpaceId: SPACE_ID,
      name: "Second open connector",
      permissionScope: [],
      type: "connector",
      uri: "public://second-open",
    });

    const list = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/sources?limit=1`, {
      headers: bearer("editor"),
    });
    expect(list.status).toBe(200);
    const listBody = await list.json();
    expect(listBody).toMatchObject({
      items: [{ id: OPEN_SOURCE_ID }],
      nextCursor: OPEN_SOURCE_ID,
    });
    expect(JSON.stringify(listBody)).not.toContain(RESTRICTED_SOURCE_ID);
    const secondPage = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/sources?limit=1&cursor=${OPEN_SOURCE_ID}`,
      { headers: bearer("editor") },
    );
    await expect(secondPage.json()).resolves.toEqual({
      items: [expect.objectContaining({ id: SECOND_OPEN_SOURCE_ID })],
    });

    const attacks: readonly {
      readonly body?: unknown;
      readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
      readonly suffix: string;
    }[] = [
      { method: "GET", suffix: "" },
      { body: { name: "stolen" }, method: "PATCH", suffix: "" },
      {
        body: { credentials: { token: "replacement" }, expectedVersion: 1 },
        method: "PUT",
        suffix: "/credentials",
      },
      { method: "DELETE", suffix: "/credentials?expectedVersion=1" },
      { body: { expectedRevision: 1 }, method: "DELETE", suffix: "?documents=keep" },
      { method: "POST", suffix: "/crawl" },
      { method: "GET", suffix: "/pages" },
      {
        body: {
          pages: [{ pageId: "page-1", type: "page", workspaceId: "workspace-1" }],
        },
        method: "POST",
        suffix: "/import",
      },
      { method: "POST", suffix: "/test" },
      { method: "GET", suffix: "/files" },
      {
        body: { files: [{ id: "file-1", name: "secret.txt" }] },
        method: "POST",
        suffix: "/import-files",
      },
    ];
    for (const attack of attacks) {
      const durableSourceDelete = attack.method === "DELETE" && attack.suffix.startsWith("?");
      const response = await fixture.app.request(
        `/knowledge-spaces/${SPACE_ID}/sources/${RESTRICTED_SOURCE_ID}${attack.suffix}`,
        {
          ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
          headers: durableSourceDelete
            ? { ...jsonBearer("editor"), "idempotency-key": "hidden-source-delete" }
            : attack.body === undefined
              ? bearer("editor")
              : jsonBearer("editor"),
          method: attack.method,
        },
      );
      expect(response.status, `${attack.method} ${attack.suffix}`).toBe(404);
      const serialized = await response.text();
      expect(serialized).not.toContain("secret://restricted");
      expect(serialized).not.toContain("must-not-leak");
    }

    const forged = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/sources`, {
      body: JSON.stringify({
        name: "Forged",
        permissionScope: [OWNER_GRANT],
        type: "web",
        uri: "https://forged.invalid",
      }),
      headers: jsonBearer("editor"),
      method: "POST",
    });
    expect(forged.status).toBe(403);
    expect(await forged.json()).toEqual({ error: "Source permission scope exceeds caller grants" });

    const allowed = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/sources`, {
      body: JSON.stringify({
        name: "Editor scoped",
        permissionScope: [EDITOR_GRANT],
        type: "web",
        uri: "https://editor.invalid",
      }),
      headers: jsonBearer("editor"),
      method: "POST",
    });
    expect(allowed.status).toBe(201);

    expect(
      (
        await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/sources/${RESTRICTED_SOURCE_ID}`, {
          headers: bearer("owner"),
        })
      ).status,
    ).toBe(200);

    // The scheduler's repository-only trusted path remains able to discover every source.
    await expect(fixture.sources.listAll({ limit: 10 })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: RESTRICTED_SOURCE_ID }),
        expect.objectContaining({ id: OPEN_SOURCE_ID }),
      ]),
    });
  });

  it("fails closed with a stable 503 instead of returning a hidden raw cursor", async () => {
    const fixture = await createFixture();
    const hiddenIds: string[] = [];
    for (let index = 1; index <= 10; index += 1) {
      const id = `93000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      hiddenIds.push(id);
      await fixture.sources.create({
        id,
        knowledgeSpaceId: SPACE_ID,
        name: `hidden-${index}`,
        permissionScope: [OWNER_GRANT],
        type: "web",
        uri: `https://hidden-${index}.invalid`,
      });
    }
    await fixture.sources.create({
      id: "93000000-0000-4000-8000-000000000011",
      knowledgeSpaceId: SPACE_ID,
      name: "visible-after-budget",
      permissionScope: [],
      type: "web",
      uri: "https://visible.invalid",
    });

    const response = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/sources?limit=1`, {
      headers: bearer("editor"),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      code: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED,
      error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("cursor");
    for (const id of hiddenIds) {
      expect(serialized).not.toContain(id);
    }

    const openapi = (await (await fixture.app.request("/openapi.json")).json()) as {
      readonly paths: Record<
        string,
        { readonly get?: { readonly responses?: Record<string, unknown> } }
      >;
    };
    expect(openapi.paths["/knowledge-spaces/{id}/sources"]?.get?.responses).toHaveProperty("503");
  });
});

async function createFixture() {
  const sources = createInMemorySourceRepository({ maxSources: 50 });
  const app = createKnowledgeGateway({
    ...createAllowingDurableDeletionSafetyOptions(),
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({ subjectsByToken: { editor, owner } }),
    durableDeletions: createAcceptingDurableDeletionService({
      requestSourceDeletion: async () => {
        throw new DurableDeletionServiceError(
          "DURABLE_DELETION_NOT_FOUND",
          "Deletion target not found",
        );
      },
    }),
    knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 20,
      maxSpaces: 5,
    }),
    sources,
  });
  expect(
    (
      await app.request("/knowledge-spaces", {
        body: JSON.stringify({ name: "Candidate sources", slug: "candidate-sources" }),
        headers: jsonBearer("owner"),
        method: "POST",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await app.request(`/knowledge-spaces/${SPACE_ID}/members`, {
        body: JSON.stringify({ role: "editor", subjectId: editor.subjectId }),
        headers: jsonBearer("owner"),
        method: "POST",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await app.request(`/knowledge-spaces/${SPACE_ID}/access-policy`, {
        body: JSON.stringify({
          expectedRevision: 1,
          partialMemberSubjectIds: [],
          visibility: "all_members",
        }),
        headers: jsonBearer("owner"),
        method: "PATCH",
      })
    ).status,
  ).toBe(200);
  return { app, sources };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function jsonBearer(token: string): Record<string, string> {
  return { ...bearer(token), "content-type": "application/json" };
}
