import type { z } from 'zod'
import { isRecord } from '@/util/is-record'
import { BadYamlFormatError } from './errors'
import { YamlStore } from './store'

export type Notice = (text: string) => void

type Path = readonly PropertyKey[]

function childOf(container: unknown, key: PropertyKey): unknown {
  if (Array.isArray(container) && typeof key === 'number') return container[key]
  return isRecord(container) && Object.hasOwn(container, key) ? container[key as string] : undefined
}

// The longest prefix of `path` that names a value in `doc`; empty when not even the
// first key exists.
function existing(doc: Record<string, unknown>, path: Path): Path {
  let at: unknown = doc
  for (const [depth, key] of path.entries()) {
    const child = childOf(at, key)
    if (child === undefined) return path.slice(0, depth)
    at = child
  }
  return path
}

function remove(doc: Record<string, unknown>, path: Path): void {
  const last = path.at(-1)
  const parent = path.slice(0, -1).reduce<unknown>(childOf, doc)
  if (Array.isArray(parent)) parent.splice(last as number, 1)
  else if (isRecord(parent)) delete parent[last as string]
}

async function readTolerant<S extends z.ZodType>(
  store: YamlStore,
  schema: S,
  notice: Notice,
): Promise<z.output<S> | null> {
  const path = store.filePath
  let raw: unknown
  try {
    raw = await store.getTyped<unknown>()
  } catch (err) {
    if (!(err instanceof BadYamlFormatError)) throw err
    notice(`${path} is not valid YAML; ignoring it`)
    return null
  }
  if (raw === null) return null
  if (!isRecord(raw)) {
    notice(`${path} is not a YAML mapping; ignoring it`)
    return null
  }
  const doc = structuredClone(raw)
  // One drop per pass: an earlier drop can resolve, move or shift a later issue's path.
  for (;;) {
    const result = schema.safeParse(doc)
    if (result.success) return result.data
    const keys = result.error.issues.map((issue) => issue.path)
    const droppable = keys.map((key) => existing(doc, key)).find((key) => key.length > 0)
    if (droppable === undefined) {
      notice(`${path} has no valid ${keys.map((key) => key.join('.')).join(', ')}; ignoring it`)
      return null
    }
    remove(doc, droppable)
    notice(`${path}: ignoring the invalid value of ${droppable.join('.')}`)
  }
}

export type LocalFile<T> = Readonly<{
  path: string
  read: () => Promise<T | null>
  write: (doc: T) => Promise<void>
  remove: () => Promise<void>
  /** Remove the file only while it still holds a document `matches` accepts. */
  removeIf: (matches: (doc: T) => boolean) => Promise<void>
}>

/** Tolerant read (bad value → default + notice; unusable file → null); write replaces the whole file. */
export function localFile<S extends z.ZodType>(
  path: string,
  schema: S,
  notice: Notice,
): LocalFile<z.output<S>> {
  const store = new YamlStore(path)
  return {
    path,
    read: () => readTolerant(store, schema, notice),
    write: async (doc) => store.setTyped(schema.parse(doc)),
    remove: () => store.rm(),
    removeIf: (matches) =>
      store.rmIf((doc) => {
        const parsed = schema.safeParse(doc)
        return parsed.success && matches(parsed.data)
      }),
  }
}
