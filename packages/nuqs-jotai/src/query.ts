import type { Options, UseQueryStatesKeysMap, Values } from 'nuqs'
import type { UrlOptions } from './adapter'

export type OptimisticValue = { query: readonly string[]; value: unknown }
export type QuerySnapshot = {
  href: string
  values: ReadonlyMap<string, OptimisticValue>
}
export type PreparedEdit = {
  query: string[] | null
  value: unknown
  options: UrlOptions
  transition: Options['startTransition']
  debounce: boolean
  delay: number
}
export type PreparedUpdate = { edits: Map<string, PreparedEdit>; keys: string[] }
export type ParseCache<P extends UseQueryStatesKeysMap> = {
  search: URLSearchParams
  optimistic: QuerySnapshot['values']
  values: Values<P>
}

export type Patch<P extends UseQueryStatesKeysMap> = Partial<{
  [K in keyof Values<P>]: Values<P>[K] | null
}> | null

export function equalQuery(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function parseValues<P extends UseQueryStatesKeysMap>(
  parsers: P,
  urlKeys: Partial<Record<keyof P, string>> | undefined,
  search: URLSearchParams,
  previous?: ParseCache<P>,
  optimistic: QuerySnapshot['values'] = new Map(),
): Values<P> {
  const keys = Object.keys(parsers) as (keyof P & string)[]
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const parser = parsers[key]!
    const urlKey = urlKeys?.[key] ?? key
    const raw = search.getAll(urlKey)
    const local = optimistic.get(urlKey)
    if (
      previous &&
      previous.optimistic.get(urlKey) === local &&
      equalQuery(previous.search.getAll(urlKey), raw)
    ) {
      result[key] = previous.values[key]
      continue
    }
    let value: unknown = null
    if (local) value = local.value
    else {
      try {
        if (raw.length > 0)
          value = parser.type === 'multi' ? parser.parse(raw) : parser.parse(raw[0]!)
      } catch {
        // Invalid external input falls back; it is never rewritten on read.
      }
    }
    value ??= parser.defaultValue ?? null
    result[key] = value
  }
  return previous && keys.every((key) => Object.is(previous.values[key], result[key]))
    ? previous.values
    : (result as Values<P>)
}

export function prepareUpdate<P extends UseQueryStatesKeysMap>(
  parsers: P,
  urlKeys: Partial<Record<keyof P, string>> | undefined,
  patch: Patch<P>,
  providerOptions: Options,
  writeOptions: Options = {},
  factoryOptions: Options = {},
): PreparedUpdate {
  const keys = Object.keys(parsers) as (keyof P & string)[]
  const keyOf = (key: keyof P & string) => urlKeys?.[key] ?? key
  const update: PreparedUpdate = { edits: new Map(), keys: keys.map(keyOf) }
  // Serialize the entire update before publishing any typed values or edits.
  for (const key of keys) {
    const requested = patch === null ? null : patch[key]
    if (requested === undefined) continue
    const parser = parsers[key]!
    function option<K extends keyof Options>(name: K): Options[K] {
      return writeOptions[name] ?? parser[name] ?? factoryOptions[name] ?? providerOptions[name]
    }
    const clear =
      requested === null ||
      (option('clearOnDefault') !== false &&
        parser.defaultValue !== undefined &&
        (parser.eq ?? Object.is)(requested, parser.defaultValue))
    const serialized = clear ? null : (parser.serialize?.(requested) ?? String(requested))
    const limit = option('limitUrlUpdates')
    update.edits.set(keyOf(key), {
      query: serialized === null ? null : Array.isArray(serialized) ? serialized : [serialized],
      value: clear ? null : requested,
      options: {
        history: option('history') ?? 'replace',
        shallow: option('shallow') ?? true,
        scroll: option('scroll') ?? false,
      },
      transition: option('startTransition'),
      debounce: limit?.method === 'debounce',
      delay: Math.max(0, limit?.timeMs ?? option('throttleMs') ?? 0),
    })
  }
  return update
}
