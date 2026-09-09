import type { Options, UseQueryStatesKeysMap, Values } from 'nuqs'
import type { UrlOptions } from './adapter'

export type PreparedUpdate = {
  edits: Map<string, string[] | null>
  keys: string[]
  options: UrlOptions
  delay: number
  debounce: boolean
  immediate: boolean
}

export type Patch<P extends UseQueryStatesKeysMap> = Partial<{
  [K in keyof Values<P>]: Values<P>[K] | null
}> | null

export function parseValues<P extends UseQueryStatesKeysMap>(
  parsers: P,
  urlKeys: Partial<Record<keyof P, string>> | undefined,
  search: URLSearchParams,
  previous?: Values<P>,
): Values<P> {
  const keys = Object.keys(parsers) as (keyof P & string)[]
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const parser = parsers[key]!
    const raw = search.getAll(urlKeys?.[key] ?? key)
    let value: unknown = null
    try {
      if (raw.length > 0)
        value = parser.type === 'multi' ? parser.parse(raw) : parser.parse(raw[0]!)
    } catch {
      // Invalid external input falls back; it is never rewritten on read.
    }
    value ??= parser.defaultValue ?? null
    const old = previous?.[key]
    result[key] = old != null && value != null && (parser.eq ?? Object.is)(old, value) ? old : value
  }
  return previous && keys.every((key) => Object.is(previous[key], result[key]))
    ? previous
    : (result as Values<P>)
}

export function prepareUpdate<P extends UseQueryStatesKeysMap>(
  parsers: P,
  urlKeys: Partial<Record<keyof P, string>> | undefined,
  patch: Patch<P>,
  defaults: Options,
  options: Options = {},
): PreparedUpdate {
  const keys = Object.keys(parsers) as (keyof P & string)[]
  const keyOf = (key: keyof P & string) => urlKeys?.[key] ?? key
  const update: PreparedUpdate = {
    edits: new Map(),
    keys: keys.map(keyOf),
    options: { history: 'replace', shallow: true, scroll: false },
    delay: 0,
    debounce: false,
    immediate: false,
  }
  // Serialize the entire business update before publishing any state.
  for (const key of keys) {
    const requested = patch === null ? null : patch[key]
    if (requested === undefined) continue
    const parser = parsers[key]!
    const settings = { ...defaults, ...parser, ...options }
    const value = requested ?? parser.defaultValue ?? null
    const clear =
      requested === null ||
      (settings.clearOnDefault !== false &&
        parser.defaultValue !== undefined &&
        (parser.eq ?? Object.is)(value, parser.defaultValue))
    const serialized = clear ? null : (parser.serialize?.(value) ?? String(value))
    update.edits.set(
      keyOf(key),
      serialized === null ? null : Array.isArray(serialized) ? serialized : [serialized],
    )
    if (settings.history === 'push') update.options.history = 'push'
    if (settings.shallow === false) update.options.shallow = false
    if (settings.scroll) update.options.scroll = true
    if (settings.limitUrlUpdates?.method === 'debounce') {
      update.debounce = true
      update.delay = Math.max(update.delay, settings.limitUrlUpdates.timeMs)
    } else {
      update.immediate = true
      update.delay = Math.max(
        update.delay,
        settings.limitUrlUpdates?.timeMs ?? settings.throttleMs ?? 0,
      )
    }
  }
  return update
}
