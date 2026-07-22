import { describe, expect, it } from "vitest";

import {
  KnowledgeFsCommandInputSchema,
  KnowledgeFsConsistencyQuerySchema,
  KnowledgeFsDiffCommandInputSchema,
  KnowledgeFsDiffQuerySchema,
  KnowledgeFsFindCommandInputSchema,
  KnowledgeFsFindQuerySchema,
  KnowledgeFsGrepCommandInputSchema,
  KnowledgeFsGrepQuerySchema,
  KnowledgeFsOpenNodeCommandInputSchema,
  KnowledgeFsOpenNodeQuerySchema,
  KnowledgeFsPathQuerySchema,
  KnowledgeFsReadCommandInputSchema,
} from "./knowledge-fs-request-schemas";

const SPACE_ID = "00000000-0000-4000-8000-000000000001";
const NODE_ID = "00000000-0000-4000-8000-000000000002";

describe("knowledge-fs-request-schemas", () => {
  it("validates bounded KnowledgeFS route query schemas", () => {
    expect(
      KnowledgeFsPathQuerySchema.parse({
        cursor: "abc",
        depth: "3",
        limit: "25",
        path: "/knowledge/by-topic/roadmap",
      }),
    ).toEqual({
      cursor: "abc",
      depth: 3,
      limit: 25,
      path: "/knowledge/by-topic/roadmap",
    });

    expect(
      KnowledgeFsGrepQuerySchema.parse({
        limit: "10",
        path: "/knowledge/by-topic/roadmap",
        q: " roadmap ",
        timeoutMs: "5000",
      }),
    ).toMatchObject({ q: "roadmap", timeoutMs: 5000 });

    expect(
      KnowledgeFsFindQuerySchema.parse({
        limit: "10",
        nameContains: "design",
        path: "/sources/uploads",
        resourceType: "document",
      }),
    ).toMatchObject({ resourceType: "document" });

    expect(
      KnowledgeFsDiffQuerySchema.parse({
        mode: "word",
        newPath: "/knowledge/current",
        oldPath: "/knowledge/previous",
        semantic: "true",
      }),
    ).toMatchObject({ semantic: "true" });

    expect(KnowledgeFsOpenNodeQuerySchema.parse({ nodeId: NODE_ID })).toEqual({ nodeId: NODE_ID });
  });

  it("validates command input schemas without coercing command integers", () => {
    expect(
      KnowledgeFsCommandInputSchema.parse({
        depth: 2,
        knowledgeSpaceId: SPACE_ID,
        limit: 25,
        path: "/knowledge/by-topic/roadmap",
      }),
    ).toMatchObject({ depth: 2, limit: 25 });

    expect(
      KnowledgeFsGrepCommandInputSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        path: "/knowledge/by-topic/roadmap",
        q: "roadmap",
      }),
    ).toMatchObject({ q: "roadmap" });

    expect(
      KnowledgeFsFindCommandInputSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        path: "/sources/uploads",
        resourceType: "document",
      }),
    ).toMatchObject({ resourceType: "document" });

    expect(
      KnowledgeFsDiffCommandInputSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        newPath: "/knowledge/current",
        oldPath: "/knowledge/previous",
      }),
    ).toMatchObject({ knowledgeSpaceId: SPACE_ID });

    expect(
      KnowledgeFsOpenNodeCommandInputSchema.parse({ knowledgeSpaceId: SPACE_ID, nodeId: NODE_ID }),
    ).toEqual({ knowledgeSpaceId: SPACE_ID, nodeId: NODE_ID });

    expect(
      KnowledgeFsReadCommandInputSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        path: "/knowledge/by-topic/roadmap",
      }),
    ).toEqual({ knowledgeSpaceId: SPACE_ID, path: "/knowledge/by-topic/roadmap" });
  });

  it("validates KnowledgeFS consistency class declarations", () => {
    for (const consistencyClass of [
      "path-consistent",
      "snapshot-consistent",
      "cache-consistent",
      "eventual-preview",
    ]) {
      expect(KnowledgeFsConsistencyQuerySchema.parse({ consistencyClass })).toEqual({
        consistencyClass,
      });
      expect(
        KnowledgeFsCommandInputSchema.parse({
          consistencyClass,
          knowledgeSpaceId: SPACE_ID,
          limit: 25,
          path: "/knowledge/by-topic/roadmap",
        }),
      ).toMatchObject({ consistencyClass });
    }

    expect(() =>
      KnowledgeFsConsistencyQuerySchema.parse({ consistencyClass: "linearizable" }),
    ).toThrow();
    expect(() =>
      KnowledgeFsCommandInputSchema.parse({
        consistencyClass: "linearizable",
        knowledgeSpaceId: SPACE_ID,
        limit: 25,
        path: "/knowledge/by-topic/roadmap",
      }),
    ).toThrow();
  });

  it("rejects invalid namespaces, unbounded route depth, and string command limits", () => {
    expect(() => KnowledgeFsPathQuerySchema.parse({ limit: "1", path: "/tmp/outside" })).toThrow();
    expect(() =>
      KnowledgeFsPathQuerySchema.parse({ depth: "9", limit: "1", path: "/knowledge/root" }),
    ).toThrow();
    expect(() =>
      KnowledgeFsCommandInputSchema.parse({
        knowledgeSpaceId: SPACE_ID,
        limit: "25",
        path: "/knowledge/root",
      }),
    ).toThrow();
  });
});
