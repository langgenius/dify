import { z } from "@hono/zod-openapi";
import {
  type AuthSubject,
  type PlatformAdapter,
  type ResourceMount,
  createCommandRegistry,
} from "@knowledge/core";

import { hasScope } from "./auth";
import type { ResourceMountRepository } from "./resource-mount-repository";
import type {
  SourceFsCatResult,
  SourceFsEntry,
  SourceFsGrepMatch,
  SourceFsGrepResult,
  SourceFsListResult,
} from "./source-fs-types";
import {
  normalizeSourceFsPath,
  sourceObjectKeyForPath,
  sourcePointerToObjectPrefix,
  sourceRelativePath,
  sourceVirtualPathForObjectKey,
} from "./storage-path-utils";

const SourceFsCommandInputSchema = z.object({
  cursor: z.string().optional(),
  knowledgeSpaceId: z.string().uuid(),
  limit: z.number().int().positive(),
  path: z.string().regex(/^\/sources(?:\/[^/\s]+)*$/),
});
type SourceFsCommandInput = z.infer<typeof SourceFsCommandInputSchema>;

const SourceFsGrepCommandInputSchema = SourceFsCommandInputSchema.extend({
  q: z.string().trim().min(1).max(4000),
});
type SourceFsGrepCommandInput = z.infer<typeof SourceFsGrepCommandInputSchema>;

const SourceFsReadCommandInputSchema = SourceFsCommandInputSchema.pick({
  knowledgeSpaceId: true,
  path: true,
});
type SourceFsReadCommandInput = z.infer<typeof SourceFsReadCommandInputSchema>;

export interface SourceFsCommandRegistryOptions {
  readonly maxGrepMatches: number;
  readonly maxGrepObjects: number;
  readonly maxListLimit: number;
  readonly maxReadBytes: number;
  readonly mounts: ResourceMountRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}

export function createSourceFsCommandRegistry({
  maxGrepMatches,
  maxGrepObjects,
  maxListLimit,
  maxReadBytes,
  mounts,
  objectStorage,
}: SourceFsCommandRegistryOptions) {
  validateSourceFsBounds({ maxGrepMatches, maxGrepObjects, maxListLimit, maxReadBytes });
  const registry = createCommandRegistry({ maxCommands: 3 });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) =>
      listSourceFsMount({
        context,
        input,
        maxListLimit,
        mounts,
        objectStorage,
      }),
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({ estimatedRows: input.limit + 1 }),
    inputSchema: SourceFsCommandInputSchema,
    name: "ls",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["source"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) =>
      catSourceFsObject({
        context,
        input,
        maxReadBytes,
        mounts,
        objectStorage,
      }),
    degradation: { strategy: "fail-closed" },
    estimateCost: () => ({ estimatedRows: 1 }),
    inputSchema: SourceFsReadCommandInputSchema,
    name: "cat",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["source"],
  });

  registry.register({
    cachePolicy: { strategy: "none" },
    defaultHandler: async ({ context, input }) =>
      grepSourceFsMount({
        context,
        input,
        maxGrepMatches,
        maxGrepObjects,
        maxReadBytes,
        mounts,
        objectStorage,
      }),
    degradation: { strategy: "fail-closed" },
    estimateCost: ({ input }) => ({
      estimatedBytes: maxReadBytes * Math.min(input.limit + 1, maxGrepObjects),
      estimatedRows: Math.min(input.limit + 1, maxGrepObjects),
    }),
    inputSchema: SourceFsGrepCommandInputSchema,
    name: "grep",
    permissionCheck: ({ subject }) => hasScope(subject, "knowledge-spaces:read"),
    supportedResourceTypes: ["source"],
  });

  return registry;
}

function validateSourceFsBounds({
  maxGrepMatches,
  maxGrepObjects,
  maxListLimit,
  maxReadBytes,
}: Pick<
  SourceFsCommandRegistryOptions,
  "maxGrepMatches" | "maxGrepObjects" | "maxListLimit" | "maxReadBytes"
>): void {
  for (const [name, value] of Object.entries({
    maxGrepMatches,
    maxGrepObjects,
    maxListLimit,
    maxReadBytes,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`SourceFS ${name} must be an integer >= 1`);
    }
  }
}

async function listSourceFsMount({
  context,
  input,
  maxListLimit,
  mounts,
  objectStorage,
}: {
  readonly context: { readonly subject: AuthSubject };
  readonly input: SourceFsCommandInput;
  readonly maxListLimit: number;
  readonly mounts: ResourceMountRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}): Promise<SourceFsListResult> {
  if (input.limit > maxListLimit) {
    throw new Error(`SourceFS list limit exceeds maxListLimit=${maxListLimit}`);
  }

  const resolved = await resolveSourceFsMount({
    capability: "ls",
    context,
    input,
    mounts,
  });
  const prefix = sourceObjectKeyForPath(resolved);
  const listPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const objects = await objectStorage.listObjects({
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit: input.limit,
    prefix: listPrefix,
  });

  return {
    items: buildSourceFsEntries({
      mountPath: resolved.mount.mountPath,
      objects: objects.objects,
      objectPrefix: listPrefix,
      parentPath: normalizeSourceFsPath(input.path),
    }),
    ...(objects.nextCursor ? { nextCursor: objects.nextCursor } : {}),
    path: normalizeSourceFsPath(input.path),
    truncated: Boolean(objects.nextCursor),
  };
}

async function catSourceFsObject({
  context,
  input,
  maxReadBytes,
  mounts,
  objectStorage,
}: {
  readonly context: { readonly subject: AuthSubject };
  readonly input: SourceFsReadCommandInput;
  readonly maxReadBytes: number;
  readonly mounts: ResourceMountRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}): Promise<SourceFsCatResult> {
  const resolved = await resolveSourceFsMount({
    capability: "cat",
    context,
    input,
    mounts,
  });

  if (!resolved.relativePath) {
    throw new Error("SourceFS object not found");
  }

  const object = await readSourceObjectText({
    key: sourceObjectKeyForPath(resolved),
    maxReadBytes,
    objectStorage,
  });

  return {
    ...(object.contentType ? { contentType: object.contentType } : {}),
    path: normalizeSourceFsPath(input.path),
    sizeBytes: object.sizeBytes,
    text: object.text,
    truncated: false,
  };
}

async function grepSourceFsMount({
  context,
  input,
  maxGrepMatches,
  maxGrepObjects,
  maxReadBytes,
  mounts,
  objectStorage,
}: {
  readonly context: { readonly subject: AuthSubject };
  readonly input: SourceFsGrepCommandInput;
  readonly maxGrepMatches: number;
  readonly maxGrepObjects: number;
  readonly maxReadBytes: number;
  readonly mounts: ResourceMountRepository;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}): Promise<SourceFsGrepResult> {
  if (input.limit > maxGrepMatches) {
    throw new Error(`SourceFS grep limit exceeds maxGrepMatches=${maxGrepMatches}`);
  }

  const resolved = await resolveSourceFsMount({
    capability: "grep",
    context,
    input,
    mounts,
  });
  const prefix = sourceObjectKeyForPath(resolved);
  const listPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const objects = await objectStorage.listObjects({
    ...(input.cursor ? { cursor: input.cursor } : {}),
    limit: maxGrepObjects,
    prefix: listPrefix,
  });
  const matches: Array<SourceFsGrepMatch & { readonly cursor: string }> = [];
  const query = input.q.toLocaleLowerCase();

  for (const objectMetadata of objects.objects) {
    const object = await readSourceObjectText({
      key: objectMetadata.key,
      maxReadBytes,
      objectStorage,
    });
    const startOffset = object.text.toLocaleLowerCase().indexOf(query);

    if (startOffset < 0) {
      continue;
    }

    matches.push({
      cursor: objectMetadata.key,
      ...(object.contentType ? { contentType: object.contentType } : {}),
      endOffset: startOffset + input.q.length,
      metadata: cloneStringRecord(object.metadata),
      path: sourceVirtualPathForObjectKey({
        mountPath: resolved.mount.mountPath,
        objectKey: objectMetadata.key,
        objectPrefix: listPrefix,
      }),
      sizeBytes: object.sizeBytes,
      snippet: object.text,
      startOffset,
    });
  }

  const page = matches.slice(0, input.limit);
  const lastMatch = page.at(-1);
  const nextCursor =
    matches.length > input.limit && lastMatch ? lastMatch.cursor : objects.nextCursor;

  return {
    matches: page.map(({ cursor: _cursor, ...match }) => match),
    ...(nextCursor ? { nextCursor } : {}),
    path: normalizeSourceFsPath(input.path),
    truncated: Boolean(nextCursor),
  };
}

async function resolveSourceFsMount({
  capability,
  context,
  input,
  mounts,
}: {
  readonly capability: "cat" | "grep" | "ls";
  readonly context: { readonly subject: AuthSubject };
  readonly input: Pick<SourceFsCommandInput, "knowledgeSpaceId" | "path">;
  readonly mounts: ResourceMountRepository;
}): Promise<{
  readonly objectPrefix: string;
  readonly relativePath: string;
  readonly mount: ResourceMount;
}> {
  const mount = await mounts.findByPath({
    knowledgeSpaceId: input.knowledgeSpaceId,
    path: input.path,
    tenantId: context.subject.tenantId,
  });

  if (!mount) {
    throw new Error("SourceFS mount not found");
  }

  if (!mount.capabilities.includes(capability)) {
    throw new Error(`SourceFS mount ${mount.mountPath} does not support ${capability}`);
  }

  const objectPrefix = sourcePointerToObjectPrefix(mount);
  const relativePath = sourceRelativePath(input.path, mount.mountPath);

  return {
    mount,
    objectPrefix,
    relativePath,
  };
}

async function readSourceObjectText({
  key,
  maxReadBytes,
  objectStorage,
}: {
  readonly key: string;
  readonly maxReadBytes: number;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}): Promise<{
  readonly contentType?: string;
  readonly metadata: Record<string, string>;
  readonly sizeBytes: number;
  readonly text: string;
}> {
  const metadata = await objectStorage.headObject(key);

  if (!metadata) {
    throw new Error("SourceFS object not found");
  }

  if (metadata.sizeBytes > maxReadBytes) {
    throw new Error(`SourceFS object exceeds maxReadBytes=${maxReadBytes}`);
  }

  const body = await objectStorage.getObject(key);

  if (!body) {
    throw new Error("SourceFS object not found");
  }

  if (body.byteLength > maxReadBytes) {
    throw new Error(`SourceFS object exceeds maxReadBytes=${maxReadBytes}`);
  }

  return {
    ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
    metadata: cloneStringRecord(metadata.metadata),
    sizeBytes: body.byteLength,
    text: new TextDecoder().decode(body),
  };
}

function buildSourceFsEntries({
  mountPath,
  objects,
  objectPrefix,
  parentPath,
}: {
  readonly mountPath: string;
  readonly objects: readonly {
    readonly contentType?: string;
    readonly key: string;
    readonly metadata: Readonly<Record<string, string>>;
    readonly sizeBytes: number;
  }[];
  readonly objectPrefix: string;
  readonly parentPath: string;
}): SourceFsEntry[] {
  const entries = new Map<string, SourceFsEntry>();

  for (const object of objects) {
    const relativePath = object.key.slice(objectPrefix.length);
    const [name, ...rest] = relativePath.split("/");

    if (!name) {
      continue;
    }

    const entryPath = `${parentPath}/${name}`;

    if (entries.has(entryPath)) {
      continue;
    }

    if (rest.length > 0) {
      entries.set(entryPath, {
        kind: "directory",
        metadata: {},
        name,
        path: entryPath,
      });
      continue;
    }

    entries.set(entryPath, {
      ...(object.contentType ? { contentType: object.contentType } : {}),
      kind: "object",
      metadata: cloneStringRecord(object.metadata),
      name,
      path: sourceVirtualPathForObjectKey({
        mountPath,
        objectKey: object.key,
        objectPrefix,
      }),
      sizeBytes: object.sizeBytes,
    });
  }

  return [...entries.values()];
}

function cloneStringRecord(value: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(value));
}
