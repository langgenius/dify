import { describe, expect, it } from "vitest";

import { KnowledgeFsValidationError } from "./knowledge-fs-errors";
import {
  assertKnowledgeFsByCommunityListPath,
  assertKnowledgeFsByTopicListPath,
  isKnowledgeFsByCommunityPath,
  isKnowledgeFsByEntityPath,
  isKnowledgeFsByTopicPath,
  knowledgeFsByEntityIdFromPath,
  knowledgePathDescendantPrefix,
  normalizeKnowledgeFsPath,
  parseKnowledgeFsPhysicalPath,
} from "./knowledge-fs-path-utils";

describe("KnowledgeFS path utilities", () => {
  it("normalizes paths and builds descendant prefixes", () => {
    expect(normalizeKnowledgeFsPath("/knowledge/by-type/docs///")).toBe("/knowledge/by-type/docs");
    expect(knowledgePathDescendantPrefix("/knowledge/by-type/docs///")).toBe(
      "/knowledge/by-type/docs/",
    );
  });

  it("parses physical paths with a required view name", () => {
    expect(parseKnowledgeFsPhysicalPath("/knowledge/by-type/docs")).toEqual({
      path: "/knowledge/by-type/docs",
      viewName: "by-type",
    });

    expect(() => parseKnowledgeFsPhysicalPath("/knowledge")).toThrow(KnowledgeFsValidationError);
  });

  it("classifies and decodes by-entity paths", () => {
    expect(isKnowledgeFsByEntityPath("/knowledge/by-entity")).toBe(true);
    expect(isKnowledgeFsByEntityPath("/knowledge/by-entity/entity%7C1")).toBe(true);
    expect(isKnowledgeFsByEntityPath("/knowledge/by-topic/topic-a")).toBe(false);
    expect(knowledgeFsByEntityIdFromPath("/knowledge/by-entity/entity%7C1")).toBe("entity|1");
    expect(() => knowledgeFsByEntityIdFromPath("/knowledge/by-entity/a/b")).toThrow(
      KnowledgeFsValidationError,
    );
  });

  it("classifies and validates by-topic list paths", () => {
    expect(isKnowledgeFsByTopicPath("/knowledge/by-topic")).toBe(true);
    expect(isKnowledgeFsByTopicPath("/knowledge/by-topic/topic-a")).toBe(true);
    expect(isKnowledgeFsByTopicPath("/knowledge/by-entity/entity-a")).toBe(false);
    expect(() => assertKnowledgeFsByTopicListPath("/knowledge/by-topic/topic-a/extra")).toThrow(
      KnowledgeFsValidationError,
    );
  });

  it("classifies and validates by-community list paths", () => {
    expect(isKnowledgeFsByCommunityPath("/knowledge/by-community")).toBe(true);
    expect(isKnowledgeFsByCommunityPath("/knowledge/by-community/acme-risk")).toBe(true);
    expect(isKnowledgeFsByCommunityPath("/knowledge/by-topic/topic-a")).toBe(false);
    expect(() =>
      assertKnowledgeFsByCommunityListPath("/knowledge/by-community/acme-risk/extra"),
    ).toThrow(KnowledgeFsValidationError);
  });
});
