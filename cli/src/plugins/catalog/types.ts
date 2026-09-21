import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export const CATALOG_PATH = '/openapi/v1/_catalog'
export const CATALOG_HEADER = 'X-Dify-Catalog'

export type JsonSchema = Record<string, unknown>
export type Example = Readonly<{ title: string; input: Record<string, unknown> }>
export type CatalogOp = Readonly<{
  summary: string
  method: string
  path: string
  kind: string
  input: JsonSchema
  bind: Readonly<Record<string, string>>
  tags: readonly string[]
  internal: boolean
  deprecated: boolean
  examples: readonly Example[]
}>
export type CatalogDoc = Readonly<{ ops: Readonly<Record<string, CatalogOp>> }>

const EXAMPLE_SCHEMA = z.object({ title: z.string(), input: z.record(z.string(), z.unknown()) })

// kind and bind values are unrestricted here: unknown kinds/binds are a forward-compat
// contract, not a parse error.
const CATALOG_OP_SCHEMA = z
  .object({
    summary: z.string(),
    method: z.string(),
    path: z.string(),
    kind: z.string(),
    input: z.record(z.string(), z.unknown()),
    bind: z.record(z.string(), z.string()),
    tags: z.array(z.string()),
    internal: z.boolean(),
    deprecated: z.boolean(),
    examples: z.array(EXAMPLE_SCHEMA).default([]),
  })
  .catchall(z.unknown())

const CATALOG_DOC_SCHEMA = z.object({ ops: z.record(z.string(), CATALOG_OP_SCHEMA) })

export function parseCatalog(bytes: Uint8Array): CatalogDoc {
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    throw new BaseError({
      code: ErrorCode.CatalogUnavailable,
      message: 'catalog document is not valid JSON',
      cause,
    })
  }
  const result = CATALOG_DOC_SCHEMA.safeParse(raw)
  if (!result.success) {
    throw new BaseError({
      code: ErrorCode.CatalogUnavailable,
      message: `catalog document failed validation: ${result.error.issues.map((issue) => issue.message).join('; ')}`,
    })
  }
  return result.data as CatalogDoc
}
