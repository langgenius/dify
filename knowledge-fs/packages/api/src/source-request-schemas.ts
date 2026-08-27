import { z } from "@hono/zod-openapi";

const DEFAULT_SOURCE_LIST_LIMIT = 50;
export const SOURCE_URI_MAX_LENGTH = 4096;

const SourceListLimitSchema = z.preprocess(
  (value) => (value === undefined ? DEFAULT_SOURCE_LIST_LIMIT : value),
  z.coerce.number().int().min(1).max(200),
);

export const SourceSpaceParamsSchema = z.object({
  id: z.string().uuid(),
});

export const SourceParamsSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
});

export const ListSourcesQuerySchema = z
  .object({
    cursor: z.string().optional(),
    limit: SourceListLimitSchema,
  })
  .strict();

/** @deprecated Source deletion is registered by the durable-deletion routes. */
export const DeleteSourceQuerySchema = z
  .object({
    documents: z.enum(["cascade", "keep"]).default("cascade"),
  })
  .strict();

export const CreateSourceSchema = z
  .object({
    connectionId: z.string().uuid().optional(),
    credentials: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    name: z.string().min(1).max(200),
    permissionScope: z.array(z.string().min(1)).optional(),
    status: z.enum(["active", "syncing", "error", "disabled"]).optional(),
    type: z.enum(["upload", "object-storage", "connector", "web"]),
    uri: z.string().min(1),
  })
  .strict()
  .refine((value) => !(value.connectionId && value.credentials), {
    message: "connectionId and inline credentials are mutually exclusive",
  });

export const UpdateSourceSchema = z
  .object({
    /**
     * Optimistic-concurrency guard: pass the `version` from the last read to make the update
     * fail with 409 instead of overwriting a concurrent modification.
     */
    expectedVersion: z.number().int().min(1).optional(),
    metadata: z
      .record(z.unknown())
      .refine(
        (metadata) => !Object.prototype.hasOwnProperty.call(metadata, "parameters"),
        "Use providerParameters to update provider parameters",
      )
      .optional(),
    name: z.string().min(1).max(200).optional(),
    providerParameters: z
      .record(z.union([z.boolean(), z.number().finite(), z.string()]))
      .refine((parameters) => {
        const keys = Object.keys(parameters);
        return keys.length <= 50 && keys.every((key) => key.length >= 1 && key.length <= 255);
      }, "Provider parameters must contain at most 50 bounded keys")
      .optional(),
    status: z.enum(["active", "syncing", "error", "disabled"]).optional(),
    uri: z.string().min(1).max(SOURCE_URI_MAX_LENGTH).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.metadata !== undefined ||
      value.name !== undefined ||
      value.providerParameters !== undefined ||
      value.status !== undefined ||
      value.uri !== undefined,
    "At least one source update is required",
  );

export const RotateSourceCredentialsSchema = z
  .object({
    credentials: z.record(z.unknown()),
    expectedVersion: z.number().int().min(1),
  })
  .strict();

export const RevokeSourceCredentialsQuerySchema = z
  .object({
    expectedVersion: z.coerce.number().int().min(1),
  })
  .strict();

export const BrowseSourceFilesQuerySchema = z
  .object({
    bucket: z.string().optional(),
    continuationToken: z.string().min(1).max(4096).optional(),
    maxKeys: z.coerce.number().int().min(1).max(1000).optional(),
    prefix: z.string().optional(),
  })
  .strict();

export const ListSourcePagesQuerySchema = z
  .object({
    cursor: z.string().min(1).max(4096).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const ImportSourceFilesSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            bucket: z.string().optional(),
            id: z.string().min(1),
            mimeType: z.string().optional(),
            name: z.string().min(1).max(255),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();

export const ImportSourcePagesSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            lastEditedTime: z.string().min(1).optional(),
            name: z.string().min(1).max(200).optional(),
            pageId: z.string().min(1),
            type: z.string().min(1),
            workspaceId: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
