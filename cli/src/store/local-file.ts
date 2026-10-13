import type { z } from 'zod'
import { isRecord } from '@/util/is-record'
import { BadYamlFormatError } from './errors'
import { YamlStore } from './store'

export type Notice = (text: string) => void

type Path = readonly PropertyKey[]

function drop(doc: Record<string, unknown>, path: Path): boolean {
  const last = path.at(-1)
  const parent = path.slice(0, -1).reduce<unknown>((acc, key) => {
    return isRecord(acc) ? acc[key as string] : undefined
  }, doc)
  if (last === undefined || !isRecord(parent) || !(last in parent)) return false
  delete parent[last as string]
  return true
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
  for (;;) {
    const result = schema.safeParse(doc)
    if (result.success) return result.data
    const keys = result.error.issues.map((issue) => issue.path)
    const dropped = keys.filter((key) => drop(doc, key))
    if (dropped.length === 0) {
      notice(`${path} has no valid ${keys.map((key) => key.join('.')).join(', ')}; ignoring it`)
      return null
    }
    for (const key of dropped) notice(`${path}: ignoring the invalid value of ${key.join('.')}`)
  }
}

export type LocalFile<T> = Readonly<{
  path: string
  read: () => Promise<T | null>
  write: (doc: T) => Promise<void>
  remove: () => Promise<void>
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
  }
}
