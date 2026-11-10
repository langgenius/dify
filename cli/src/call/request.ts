import type { CatalogOp } from '@/plugins/catalog'
import type { HttpRequest } from '@/plugins/http'
import type { Bind } from '@/protocol/bind'
import { join } from 'node:path'
import { inputInvalid } from '@/call/errors'
import { BIND, isBind } from '@/protocol/bind'
import { isRecord } from '@/util/is-record'

export type FileReader = (
  path: string,
) => Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly name: string }>

export type FolderCheck = (path: string) => Promise<boolean>

export type FolderLister = (path: string) => Promise<readonly string[]>

export type FileDeps = {
  readonly readFile: FileReader
  readonly isFolder: FolderCheck
  readonly listFolder: FolderLister
}

const LIST_SUFFIX = '[]'
const RESERVED_KEY_CHARS = /[[\]]/

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

async function readAsFile(path: string, { readFile }: FileDeps): Promise<File> {
  let resolved: Awaited<ReturnType<FileReader>>
  try {
    resolved = await readFile(path)
  } catch (cause) {
    throw inputInvalid(`cannot read file "${path}"`, cause)
  }
  return new File([resolved.bytes], resolved.name)
}

function assertPathString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string')
    throw inputInvalid(
      `file field "${field}" must be a path string, a folder, an array of paths, or an object mapping names to paths`,
    )
}

async function assertNotFolder(path: string, field: string, deps: FileDeps): Promise<void> {
  if (await deps.isFolder(path))
    throw inputInvalid(`"${path}" is a folder; a folder can only be the whole value of ${field}`)
}

type FieldTarget = {
  readonly form: FormData
  // Top-level input key bound to `file`.
  readonly field: string
  readonly deps: FileDeps
}

type FolderParts = FieldTarget & {
  readonly folder: string
  // File paths relative to `folder`, as returned by `listFolder`.
  readonly keys: readonly string[]
}

type FileParts = FieldTarget & {
  // Multipart part name, e.g. `field`, `field[]`, `field[key]`, `field[key][]`.
  readonly name: string
  // A path string or an array of path strings; validated per item.
  readonly value: unknown
  // Input location for error messages, e.g. `field` or `field.key`.
  readonly label: string
}

async function appendFolderParts({ form, field, deps, folder, keys }: FolderParts): Promise<void> {
  if (keys.length === 0) throw inputInvalid(`folder "${folder}" has no files`)
  const reserved = keys.find((key) => RESERVED_KEY_CHARS.test(key))
  if (reserved !== undefined)
    throw inputInvalid(
      `"${reserved}" in folder "${folder}" contains "[" or "]", which a part name cannot carry`,
    )
  for (const key of keys)
    form.append(partName(field, key, false), await readAsFile(join(folder, key), deps))
}

async function appendFileParts({
  form,
  field,
  deps,
  name,
  value,
  label,
}: FileParts): Promise<void> {
  const items = Array.isArray(value) ? value : [value]
  for (const item of items) {
    assertPathString(item, label)
    await assertNotFolder(item, field, deps)
    form.append(name, await readAsFile(item, deps))
  }
}

async function appendFileField(target: FieldTarget, value: unknown): Promise<void> {
  const { form, field, deps } = target
  if (value === null || value === undefined) return
  if (typeof value === 'string') {
    if (await deps.isFolder(value))
      return appendFolderParts({ ...target, folder: value, keys: await deps.listFolder(value) })
    form.append(partName(field, undefined, false), await readAsFile(value, deps))
    return
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value))
      await appendFileParts({
        ...target,
        name: partName(field, key, Array.isArray(item)),
        value: item,
        label: `${field}.${key}`,
      })
    return
  }
  await appendFileParts({
    ...target,
    name: partName(field, undefined, Array.isArray(value)),
    value,
    label: field,
  })
}

function hasFileValue(values: Map<string, unknown>): boolean {
  return [...values.values()].some((value) => value !== null && value !== undefined)
}

export async function buildRequest(
  op: CatalogOp,
  input: Record<string, unknown>,
  deps: FileDeps,
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
    await appendFileField({ form, field, deps }, value)

  return { method: op.method, path, query, form }
}
