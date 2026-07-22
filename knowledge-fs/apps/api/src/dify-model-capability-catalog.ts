import { createHash } from "node:crypto";

import {
  type ListModelCatalogEntriesInput,
  type ListModelCatalogEntriesResult,
  type ModelCapabilityCatalog,
  type ModelCapabilityKind,
  type ModelCatalogEntry,
  ModelCatalogEntrySchema,
  type ResolveModelCatalogEntryInput,
} from "@knowledge/api";
import type {
  DifyModelCatalogItem,
  DifyModelRuntimeClient,
  DifyModelRuntimeModelType,
} from "@knowledge/dify-model-runtime-client";

export interface DifyModelCapabilityCatalogOptions {
  readonly client: DifyModelRuntimeClient;
}

interface CatalogCursor {
  readonly modelTypeIndex: number;
  readonly offset: number;
}

const MODEL_TYPES: readonly DifyModelRuntimeModelType[] = ["text-embedding", "llm", "rerank"];

/** Exposes Dify's tenant-active model configuration to KnowledgeFS preflight. */
export function createDifyModelCapabilityCatalog({
  client,
}: DifyModelCapabilityCatalogOptions): ModelCapabilityCatalog {
  return {
    list: (input) => listCatalogPage(client, input),
    resolve: (input) => resolveCatalogEntry(client, input),
  };
}

async function resolveCatalogEntry(
  client: DifyModelRuntimeClient,
  input: ResolveModelCatalogEntryInput,
): Promise<ModelCatalogEntry | null> {
  const result = await client.listModels({
    limit: 2,
    model: input.selection.model,
    modelType: modelTypeForKind(input.kind),
    pluginId: input.selection.pluginId,
    provider: input.selection.provider,
    ...(input.signal ? { signal: input.signal } : {}),
    tenantId: input.tenantId,
  });
  if (result.items.length > 1 || result.nextOffset !== undefined) {
    throw new Error("Dify returned an ambiguous active model selection");
  }
  const item = result.items[0];
  return item ? modelCatalogEntry(item) : null;
}

async function listCatalogPage(
  client: DifyModelRuntimeClient,
  input: ListModelCatalogEntriesInput,
): Promise<ListModelCatalogEntriesResult> {
  assertBoundedInteger(input.limit, "limit", 1, 100);
  const requestedTypes = input.kind ? [modelTypeForKind(input.kind)] : MODEL_TYPES;
  let cursor = input.cursor ? decodeCursor(input.cursor) : { modelTypeIndex: 0, offset: 0 };
  if (cursor.modelTypeIndex >= requestedTypes.length) {
    throw new Error("Invalid model catalog cursor");
  }

  const items: ModelCatalogEntry[] = [];
  while (cursor.modelTypeIndex < requestedTypes.length && items.length < input.limit) {
    const modelType = requestedTypes[cursor.modelTypeIndex];
    if (!modelType) {
      throw new Error("Invalid model catalog cursor");
    }
    const remaining = input.limit - items.length;
    const result = await client.listModels({
      limit: remaining,
      modelType,
      offset: cursor.offset,
      ...(input.signal ? { signal: input.signal } : {}),
      tenantId: input.tenantId,
    });
    items.push(...result.items.map(modelCatalogEntry));

    if (result.nextOffset !== undefined) {
      cursor = { modelTypeIndex: cursor.modelTypeIndex, offset: result.nextOffset };
      break;
    }
    cursor = { modelTypeIndex: cursor.modelTypeIndex + 1, offset: 0 };
  }

  return {
    items,
    ...(cursor.modelTypeIndex < requestedTypes.length ? { nextCursor: encodeCursor(cursor) } : {}),
  };
}

function modelCatalogEntry(item: DifyModelCatalogItem): ModelCatalogEntry {
  const kind = capabilityKindForModelType(item.model_type);
  const material = {
    capabilities: item.capabilities,
    model: item.model,
    modelType: item.model_type,
    pluginUniqueIdentifier: item.plugin_unique_identifier,
    provider: item.provider,
  };
  const version = pluginVersion(item.plugin_unique_identifier);
  return ModelCatalogEntrySchema.parse({
    capabilities: {
      ...item.capabilities,
      modelType: item.model_type,
      pluginUniqueIdentifier: item.plugin_unique_identifier,
    },
    kinds: [kind],
    model: item.model,
    pluginId: item.plugin_id,
    pluginUniqueIdentifier: item.plugin_unique_identifier,
    ...(version ? { pluginVersion: version } : {}),
    provider: item.provider,
    schemaFingerprint: `sha256:${createHash("sha256").update(canonicalJson(material)).digest("hex")}`,
  });
}

function capabilityKindForModelType(type: DifyModelRuntimeModelType): ModelCapabilityKind {
  if (type === "text-embedding") return "embedding";
  if (type === "llm") return "reasoning";
  return "rerank";
}

function modelTypeForKind(kind: ModelCapabilityKind): DifyModelRuntimeModelType {
  if (kind === "embedding") return "text-embedding";
  if (kind === "reasoning") return "llm";
  return "rerank";
}

function pluginVersion(uniqueIdentifier: string): string | undefined {
  return /:([^:@]+)@/u.exec(uniqueIdentifier)?.[1];
}

function encodeCursor(cursor: CatalogCursor): string {
  return Buffer.from(canonicalJson({ ...cursor, version: 1 }), "utf8").toString("base64url");
}

function decodeCursor(value: string): CatalogCursor {
  if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid model catalog cursor");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (cause) {
    throw new Error("Invalid model catalog cursor", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid model catalog cursor");
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error("Unsupported model catalog cursor version");
  }
  return {
    modelTypeIndex: boundedInteger(record.modelTypeIndex, "modelTypeIndex", 0, MODEL_TYPES.length),
    offset: boundedInteger(record.offset, "offset", 0, 1_000_000),
  };
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Invalid model catalog cursor ${name}`);
  }
  return value as number;
}

function assertBoundedInteger(value: number, name: string, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalValue(child)]),
    );
  }
  return value;
}
