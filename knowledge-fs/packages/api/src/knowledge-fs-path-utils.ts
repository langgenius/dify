import { KnowledgeFsValidationError } from "./knowledge-fs-errors";

export const KNOWLEDGE_FS_BY_ENTITY_ROOT = "/knowledge/by-entity";
export const KNOWLEDGE_FS_BY_COMMUNITY_ROOT = "/knowledge/by-community";
export const KNOWLEDGE_FS_BY_COMMUNITY_VIEW_NAME = "by-community";
export const KNOWLEDGE_FS_BY_TOPIC_ROOT = "/knowledge/by-topic";
export const KNOWLEDGE_FS_BY_TOPIC_VIEW_NAME = "by-topic";
export const LIVE_SEMANTIC_VIEW_METADATA = {
  buildStatus: "ready",
  generatedVersion: "live",
  staleStatus: "fresh",
} as const;

export function parseKnowledgeFsPhysicalPath(path: string): { path: string; viewName: string } {
  const normalized = normalizeKnowledgeFsPath(path);
  const [, , viewName] = normalized.split("/");

  if (!viewName) {
    throw new KnowledgeFsValidationError("KnowledgeFS path must include a physical view name");
  }

  return {
    path: normalized,
    viewName,
  };
}

export function normalizeKnowledgeFsPath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/u, "") : path;
}

export function isKnowledgeFsByEntityPath(path: string): boolean {
  const normalizedPath = normalizeKnowledgeFsPath(path);

  return (
    normalizedPath === KNOWLEDGE_FS_BY_ENTITY_ROOT ||
    normalizedPath.startsWith(`${KNOWLEDGE_FS_BY_ENTITY_ROOT}/`)
  );
}

export function isKnowledgeFsByCommunityPath(path: string): boolean {
  const normalizedPath = normalizeKnowledgeFsPath(path);

  return (
    normalizedPath === KNOWLEDGE_FS_BY_COMMUNITY_ROOT ||
    normalizedPath.startsWith(`${KNOWLEDGE_FS_BY_COMMUNITY_ROOT}/`)
  );
}

export function assertKnowledgeFsByCommunityListPath(path: string): void {
  const normalizedPath = normalizeKnowledgeFsPath(path);

  if (normalizedPath === KNOWLEDGE_FS_BY_COMMUNITY_ROOT) {
    return;
  }

  const relativePath = normalizedPath.slice(KNOWLEDGE_FS_BY_COMMUNITY_ROOT.length + 1);

  if (!relativePath || relativePath.split("/").length > 1) {
    throw new KnowledgeFsValidationError(
      "KnowledgeFS by-community path must include at most one community",
    );
  }
}

export function knowledgeFsByEntityIdFromPath(path: string): string | undefined {
  const normalizedPath = normalizeKnowledgeFsPath(path);

  if (normalizedPath === KNOWLEDGE_FS_BY_ENTITY_ROOT) {
    return undefined;
  }

  const entityId = normalizedPath.slice(KNOWLEDGE_FS_BY_ENTITY_ROOT.length + 1);

  if (!entityId || entityId.includes("/")) {
    throw new KnowledgeFsValidationError("KnowledgeFS by-entity path must include one entity id");
  }

  return decodeURIComponent(entityId);
}

export function isKnowledgeFsByTopicPath(path: string): boolean {
  const normalizedPath = normalizeKnowledgeFsPath(path);

  return (
    normalizedPath === KNOWLEDGE_FS_BY_TOPIC_ROOT ||
    normalizedPath.startsWith(`${KNOWLEDGE_FS_BY_TOPIC_ROOT}/`)
  );
}

export function assertKnowledgeFsByTopicListPath(path: string): void {
  const normalizedPath = normalizeKnowledgeFsPath(path);

  if (normalizedPath === KNOWLEDGE_FS_BY_TOPIC_ROOT) {
    return;
  }

  const relativePath = normalizedPath.slice(KNOWLEDGE_FS_BY_TOPIC_ROOT.length + 1);

  if (!relativePath || relativePath.split("/").length > 1) {
    throw new KnowledgeFsValidationError(
      "KnowledgeFS by-topic path must include at most one topic",
    );
  }
}

export function knowledgePathDescendantPrefix(parentPath: string): string {
  return `${normalizeKnowledgeFsPath(parentPath)}/`;
}
