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
  PluginDaemonClientWithManagement,
  PluginDaemonModelProvider,
  PluginDaemonModelSchema,
  PluginDaemonModelType,
} from "@knowledge/plugin-daemon-client";

export interface PluginDaemonModelCapabilityCatalogOptions {
  readonly client: PluginDaemonClientWithManagement;
  readonly maxPagesPerList?: number | undefined;
  readonly maxResolvePages?: number | undefined;
  readonly providerPageSize?: number | undefined;
}

interface CatalogCursor {
  readonly modelIndex: number;
  readonly page: number;
  readonly providerIndex: number;
}

const DEFAULT_PROVIDER_PAGE_SIZE = 64;
const DEFAULT_MAX_PAGES_PER_LIST = 4;
const DEFAULT_MAX_RESOLVE_PAGES = 32;
const MAX_CURSOR_COMPONENT = 1_000_000;

/** Maps the daemon's tenant-installed declarations to the stable public backend contract. */
export function createPluginDaemonModelCapabilityCatalog({
  client,
  maxPagesPerList = DEFAULT_MAX_PAGES_PER_LIST,
  maxResolvePages = DEFAULT_MAX_RESOLVE_PAGES,
  providerPageSize = DEFAULT_PROVIDER_PAGE_SIZE,
}: PluginDaemonModelCapabilityCatalogOptions): ModelCapabilityCatalog {
  assertBoundedInteger(providerPageSize, "providerPageSize", 1, 256);
  assertBoundedInteger(maxPagesPerList, "maxPagesPerList", 1, 256);
  assertBoundedInteger(maxResolvePages, "maxResolvePages", 1, 256);

  const resolve = async (
    input: ResolveModelCatalogEntryInput,
  ): Promise<ModelCatalogEntry | null> => {
    const expectedType = daemonTypeForKind(input.kind);
    let matched:
      | { provider: PluginDaemonModelProvider; schema: PluginDaemonModelSchema }
      | undefined;
    for (let page = 1; page <= maxResolvePages; page += 1) {
      const providers = await client.listModelProviders({
        page,
        pageSize: providerPageSize,
        ...(input.signal ? { signal: input.signal } : {}),
        tenantId: input.tenantId,
      });
      for (const provider of providers) {
        if (
          provider.plugin_id !== input.selection.pluginId ||
          provider.provider !== input.selection.provider
        ) {
          continue;
        }
        const declared = provider.declaration.models.find(
          (model) => model.model === input.selection.model && model.model_type === expectedType,
        );
        let schema = declared;
        if (
          !schema &&
          provider.declaration.configurate_methods.includes("customizable-model") &&
          provider.declaration.supported_model_types.includes(expectedType)
        ) {
          schema = await client.getModelSchema({
            credentials: {},
            model: input.selection.model,
            modelType: expectedType,
            pluginId: provider.plugin_id,
            provider: provider.provider,
            ...(input.signal ? { signal: input.signal } : {}),
            tenantId: input.tenantId,
          });
          if (schema.model !== input.selection.model || schema.model_type !== expectedType) {
            throw new Error("Plugin daemon returned a mismatched customizable model schema");
          }
        }
        if (!schema) {
          continue;
        }
        if (
          matched &&
          matched.provider.plugin_unique_identifier !== provider.plugin_unique_identifier
        ) {
          throw new Error("Plugin daemon returned an ambiguous installed model identity");
        }
        matched = { provider, schema };
      }
      if (providers.length < providerPageSize) {
        break;
      }
    }
    return matched ? modelCatalogEntry(matched.provider, matched.schema) : null;
  };

  return {
    list: (input) => listCatalogPage(client, input, { maxPagesPerList, providerPageSize }),
    resolve,
    validate: async (input) => {
      const resolved = await resolve(input);
      if (!resolved) {
        return false;
      }
      const result = await client.validateModelCredentials({
        credentials: {},
        model: input.selection.model,
        modelType: daemonTypeForKind(input.kind),
        pluginId: input.selection.pluginId,
        provider: input.selection.provider,
        ...(input.signal ? { signal: input.signal } : {}),
        tenantId: input.tenantId,
      });
      return result.result;
    },
  };
}

async function listCatalogPage(
  client: PluginDaemonClientWithManagement,
  input: ListModelCatalogEntriesInput,
  bounds: { readonly maxPagesPerList: number; readonly providerPageSize: number },
): Promise<ListModelCatalogEntriesResult> {
  assertBoundedInteger(input.limit, "limit", 1, 100);
  let cursor = input.cursor ? decodeCatalogCursor(input.cursor) : initialCursor();
  const collected: Array<{ readonly after: CatalogCursor; readonly entry: ModelCatalogEntry }> = [];
  let scannedPages = 0;
  let exhausted = false;

  while (collected.length <= input.limit && scannedPages < bounds.maxPagesPerList && !exhausted) {
    const providers = await client.listModelProviders({
      page: cursor.page,
      pageSize: bounds.providerPageSize,
      ...(input.signal ? { signal: input.signal } : {}),
      tenantId: input.tenantId,
    });
    scannedPages += 1;

    while (cursor.providerIndex < providers.length && collected.length <= input.limit) {
      const provider = providers[cursor.providerIndex];
      if (!provider) {
        throw new Error("Plugin daemon provider page changed during traversal");
      }
      const models = provider.declaration.models;
      while (cursor.modelIndex < models.length && collected.length <= input.limit) {
        const schema = models[cursor.modelIndex];
        cursor = {
          modelIndex: cursor.modelIndex + 1,
          page: cursor.page,
          providerIndex: cursor.providerIndex,
        };
        if (!schema) {
          throw new Error("Plugin daemon model page changed during traversal");
        }
        const kind = capabilityKindForDaemonType(schema.model_type);
        if (kind && (!input.kind || input.kind === kind)) {
          collected.push({ after: cursor, entry: modelCatalogEntry(provider, schema) });
        }
      }
      if (cursor.modelIndex >= models.length) {
        cursor = {
          modelIndex: 0,
          page: cursor.page,
          providerIndex: cursor.providerIndex + 1,
        };
      }
    }

    if (cursor.providerIndex >= providers.length) {
      exhausted = providers.length < bounds.providerPageSize;
      if (!exhausted) {
        cursor = { modelIndex: 0, page: cursor.page + 1, providerIndex: 0 };
      }
    }
  }

  const items = collected.slice(0, input.limit).map((item) => item.entry);
  if (collected.length > input.limit) {
    const afterLast = collected[input.limit - 1]?.after;
    if (!afterLast) {
      throw new Error("Model catalog cursor state is unavailable");
    }
    return { items, nextCursor: encodeCatalogCursor(afterLast) };
  }
  if (!exhausted && scannedPages >= bounds.maxPagesPerList) {
    return { items, nextCursor: encodeCatalogCursor(cursor) };
  }
  return { items };
}

function modelCatalogEntry(
  provider: PluginDaemonModelProvider,
  schema: PluginDaemonModelSchema,
): ModelCatalogEntry {
  const kind = capabilityKindForDaemonType(schema.model_type);
  if (!kind) {
    throw new Error(`Unsupported model type ${schema.model_type}`);
  }
  const material = {
    pluginUniqueIdentifier: provider.plugin_unique_identifier,
    provider: provider.provider,
    schema,
  };
  return ModelCatalogEntrySchema.parse({
    capabilities: {
      configurationMethods: [...provider.declaration.configurate_methods],
      ...(schema.deprecated === undefined ? {} : { deprecated: schema.deprecated }),
      ...(schema.features ? { features: [...schema.features] } : {}),
      ...(schema.fetch_from ? { fetchFrom: schema.fetch_from } : {}),
      modelType: schema.model_type,
      pluginUniqueIdentifier: provider.plugin_unique_identifier,
      ...(schema.model_properties
        ? { modelProperties: publicModelProperties(schema.model_properties) }
        : {}),
    },
    kinds: [kind],
    model: schema.model,
    pluginId: provider.plugin_id,
    pluginUniqueIdentifier: provider.plugin_unique_identifier,
    ...(pluginVersion(provider.plugin_unique_identifier)
      ? { pluginVersion: pluginVersion(provider.plugin_unique_identifier) }
      : {}),
    provider: provider.provider,
    schemaFingerprint: `sha256:${createHash("sha256").update(canonicalJson(material)).digest("hex")}`,
  });
}

function publicModelProperties(
  input: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const entries = Object.entries(input)
    .filter(
      (entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === "string" ||
        typeof entry[1] === "number" ||
        typeof entry[1] === "boolean",
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 64)
    .map(([key, value]) => [
      key.slice(0, 128),
      typeof value === "string" ? value.slice(0, 512) : value,
    ]);
  return Object.fromEntries(entries);
}

function capabilityKindForDaemonType(type: PluginDaemonModelType): ModelCapabilityKind | undefined {
  if (type === "text-embedding") return "embedding";
  if (type === "llm") return "reasoning";
  if (type === "rerank") return "rerank";
  return undefined;
}

function daemonTypeForKind(kind: ModelCapabilityKind): PluginDaemonModelType {
  if (kind === "embedding") return "text-embedding";
  if (kind === "reasoning") return "llm";
  return "rerank";
}

function pluginVersion(uniqueIdentifier: string): string | undefined {
  return /:([^:@]+)@/u.exec(uniqueIdentifier)?.[1];
}

function initialCursor(): CatalogCursor {
  return { modelIndex: 0, page: 1, providerIndex: 0 };
}

function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(canonicalJson({ ...cursor, version: 1 }), "utf8").toString("base64url");
}

function decodeCatalogCursor(value: string): CatalogCursor {
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
  const page = cursorInteger(record.page, "page", 1);
  const providerIndex = cursorInteger(record.providerIndex, "providerIndex", 0);
  const modelIndex = cursorInteger(record.modelIndex, "modelIndex", 0);
  return { modelIndex, page, providerIndex };
}

function cursorInteger(value: unknown, name: string, minimum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > MAX_CURSOR_COMPONENT
  ) {
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
