import { KnowledgeFsValidationError } from "./knowledge-fs-errors";

export interface GraphEntityCursorValue {
  readonly id: string;
  readonly name: string;
}

export interface KnowledgePathCursorValue {
  readonly id: string;
  readonly virtualPath: string;
}

export interface GoldenQuestionCursorValue {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeGraphEntityCursor(cursor: GraphEntityCursorValue): string {
  return `${encodeURIComponent(cursor.name)}|${encodeURIComponent(cursor.id)}`;
}

export function decodeGraphEntityCursor(cursor: string): GraphEntityCursorValue {
  const [encodedName, encodedId] = cursor.split("|");

  if (!encodedName || !encodedId) {
    throw new KnowledgeFsValidationError("KnowledgeFS by-entity cursor is invalid");
  }

  return {
    id: decodeURIComponent(encodedId),
    name: decodeURIComponent(encodedName),
  };
}

export function encodeKnowledgePathCursor(cursor: KnowledgePathCursorValue): string {
  return `${encodeURIComponent(cursor.virtualPath)}|${cursor.id}`;
}

export function decodeKnowledgePathCursor(cursor: string): KnowledgePathCursorValue {
  const [encodedPath, id] = cursor.split("|");

  if (!encodedPath || !id) {
    throw new KnowledgeFsValidationError("KnowledgeFS cursor is invalid");
  }

  return {
    id,
    virtualPath: decodeURIComponent(encodedPath),
  };
}

export function encodeGoldenQuestionCursor(cursor: GoldenQuestionCursorValue): string {
  return `${encodeURIComponent(cursor.createdAt)}|${cursor.id}`;
}

export function decodeGoldenQuestionCursor(cursor: string): GoldenQuestionCursorValue {
  const [encodedCreatedAt, id] = cursor.split("|");

  if (!encodedCreatedAt || !id) {
    throw new KnowledgeFsValidationError("Invalid golden question cursor");
  }

  return {
    createdAt: decodeURIComponent(encodedCreatedAt),
    id,
  };
}
