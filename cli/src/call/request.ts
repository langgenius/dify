import type { CatalogOp } from '@/plugins/catalog'
import type { HttpRequest } from '@/plugins/http'
import type { Bind } from '@/protocol/bind'
import { inputInvalid } from '@/call/errors'
import { BIND, isBind } from '@/protocol/bind'
import { isRecord } from '@/util/is-record'

export type FileReader = (
  path: string,
) => Promise<{ readonly bytes: Uint8Array; readonly name: string }>

const LIST_SUFFIX = '[]'

const HttpMethod = { Get: 'GET', Delete: 'DELETE' } as const
const BODYLESS_METHODS: ReadonlySet<string> = new Set(Object.values(HttpMethod))

const Placement = { Path: 'path', Query: 'query', Body: 'body', File: 'file' } as const
type PlacementValue = (typeof Placement)[keyof typeof Placement]

const BIND_PLACEMENT: Readonly<Record<Bind, PlacementValue>> = {
  [BIND.Path]: Placement.Path,
  [BIND.Query]: Placement.Query,
  [BIND.Body]: Placement.Body,
  [BIND.File]: Placement.File,
}

type Buckets = Readonly<Record<PlacementValue, Map<string, unknown>>>

function defaultPlacement(method: string): PlacementValue {
  return BODYLESS_METHODS.has(method) ? Placement.Query : Placement.Body
}

// Every input key is placed before anything else is built: an unsupported bind
// value must fail before a byte of the request exists.
function classify(op: CatalogOp, input: Record<string, unknown>): Buckets {
  const buckets: Buckets = {
    [Placement.Path]: new Map(),
    [Placement.Query]: new Map(),
    [Placement.Body]: new Map(),
    [Placement.File]: new Map(),
  }
  const fallback = defaultPlacement(op.method)
  for (const [key, value] of Object.entries(input)) {
    const bindValue = op.bind[key]
    if (bindValue === undefined) {
      buckets[fallback].set(key, value)
      continue
    }
    if (!isBind(bindValue))
      throw inputInvalid(`bind value ${bindValue} for ${key} is not supported by this difyctl`)
    buckets[BIND_PLACEMENT[bindValue]].set(key, value)
  }
  return buckets
}

function substitutePath(path: string, values: Map<string, unknown>): string {
  return path.replace(/\{([^{}]+)\}/g, (placeholder, name: string) =>
    values.has(name) ? encodeURIComponent(String(values.get(name))) : placeholder,
  )
}

function toQueryValue(value: unknown): string | readonly string[] | undefined {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) return value.map((item) => String(item))
  return String(value)
}

function buildQuery(values: Map<string, unknown>): HttpRequest['query'] {
  const query: Record<string, string | readonly string[]> = {}
  for (const [key, value] of values) {
    const converted = toQueryValue(value)
    if (converted !== undefined) query[key] = converted
  }
  return Object.keys(query).length === 0 ? undefined : query
}

function buildBodyObject(values: Map<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [key, value] of values) {
    if (value === undefined) continue
    body[key] = value
  }
  return body
}

function partName(field: string, key: string | undefined, many: boolean): string {
  const base = key === undefined ? field : `${field}[${key}]`
  return many ? `${base}${LIST_SUFFIX}` : base
}

async function readAsFile(path: string, readFile: FileReader): Promise<File> {
  let resolved: { bytes: Uint8Array; name: string }
  try {
    resolved = await readFile(path)
  } catch (cause) {
    throw inputInvalid(`cannot read file "${path}"`, cause)
  }
  return new File([Uint8Array.from(resolved.bytes)], resolved.name)
}

function assertPathString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string')
    throw inputInvalid(
      `file field "${field}" must be a path string, an array of paths, or an object mapping names to paths`,
    )
}

async function appendFileParts(
  form: FormData,
  name: string,
  value: unknown,
  field: string,
  readFile: FileReader,
): Promise<void> {
  if (Array.isArray(value)) {
    for (const item of value) {
      assertPathString(item, field)
      form.append(name, await readAsFile(item, readFile))
    }
    return
  }
  assertPathString(value, field)
  form.append(name, await readAsFile(value, readFile))
}

async function appendFileField(
  form: FormData,
  field: string,
  value: unknown,
  readFile: FileReader,
): Promise<void> {
  if (value === null || value === undefined) return
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value))
      await appendFileParts(
        form,
        partName(field, key, Array.isArray(item)),
        item,
        `${field}.${key}`,
        readFile,
      )
    return
  }
  await appendFileParts(
    form,
    partName(field, undefined, Array.isArray(value)),
    value,
    field,
    readFile,
  )
}

function hasFileValue(values: Map<string, unknown>): boolean {
  return [...values.values()].some((value) => value !== null && value !== undefined)
}

export async function buildRequest(
  op: CatalogOp,
  input: Record<string, unknown>,
  deps: { readonly readFile: FileReader },
): Promise<HttpRequest> {
  const buckets = classify(op, input)
  const path = substitutePath(op.path, buckets[Placement.Path])
  const query = buildQuery(buckets[Placement.Query])

  if (!hasFileValue(buckets[Placement.File])) {
    const bodyObj = buildBodyObject(buckets[Placement.Body])
    const isEmptyBodylessRequest =
      BODYLESS_METHODS.has(op.method) && Object.keys(bodyObj).length === 0
    return { method: op.method, path, query, json: isEmptyBodylessRequest ? undefined : bodyObj }
  }

  const form = new FormData()
  for (const [key, value] of buckets[Placement.Body]) {
    if (value === undefined) continue
    form.append(key, JSON.stringify(value))
  }
  for (const [field, value] of buckets[Placement.File])
    await appendFileField(form, field, value, deps.readFile)

  return { method: op.method, path, query, form }
}
