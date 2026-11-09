import type { z } from 'zod'
import type { Change } from './store'
import { isRecord } from '@/util/is-record'
import { BadYamlFormatError } from './errors'
import { loadYaml, REMOVE, YamlStore } from './store'

export { REMOVE } from './store'

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

function readTolerant<S extends z.ZodType>(
  content: string | undefined,
  schema: S,
  path: string,
  notice: Notice,
): z.output<S> | null {
  let raw: unknown
  try {
    raw = loadYaml(content, path)
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
  /** The only way to change the file: `change` sees the latest document, under the file's lock. */
  update: (change: (doc: T | null) => Change<T>) => Promise<void>
}>

// A file is read again on every use, so the same problem would be reported each time.
function onceEach(notice: Notice): Notice {
  const said = new Set<string>()
  return (text) => {
    if (said.has(text)) return
    said.add(text)
    notice(text)
  }
}

/** Tolerant read (bad value → default + notice; unusable file → null); update writes the whole file. */
export function localFile<S extends z.ZodType>(
  path: string,
  schema: S,
  notice: Notice,
): LocalFile<z.output<S>> {
  const store = new YamlStore(path)
  const report = onceEach(notice)
  return {
    path,
    read: async () => readTolerant(await store.read(), schema, path, report),
    update: (change) =>
      store.update((content) => {
        const next = change(readTolerant(content, schema, path, report))
        return next === undefined || next === REMOVE ? next : schema.parse(next)
      }),
  }
}
