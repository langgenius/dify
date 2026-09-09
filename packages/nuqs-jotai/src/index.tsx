'use client'

import type { Atom, WritableAtom } from 'jotai'
import type { Options, SetValues, UseQueryStatesKeysMap, UseQueryStatesOptions, Values } from 'nuqs'
import type { ReactNode } from 'react'
import type { QueryAdapter } from './adapter'
import { atom, useStore } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useEffect, useInsertionEffect, useLayoutEffect, useState } from 'react'
import { parseValues, prepareUpdate } from './query'
import { createQueryRuntime } from './runtime'

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
type Runtime = ReturnType<typeof createQueryRuntime>
const runtimeAtom = atom<{ runtime: Runtime; defaults: Options } | null>(null)
runtimeAtom.debugLabel = 'url.runtime'

export type QueryAtom<Value> = WritableAtom<
  Value,
  [update: Value | null | ((previous: Value) => Value | null), options?: Options],
  Promise<URLSearchParams>
>

export type QueryAtoms<P extends UseQueryStatesKeysMap> = {
  readonly atom: WritableAtom<Values<P>, Parameters<SetValues<P>>, Promise<URLSearchParams>>
  readonly atoms: { readonly [K in keyof P]: QueryAtom<Values<P>[K]> }
  readonly errorAtom: Atom<unknown>
}

export type CreateQueryAtomsOptions<P extends UseQueryStatesKeysMap> = {
  urlKeys?: UseQueryStatesOptions<P>['urlKeys']
  debugLabel?: string
}

/** Definitions need no registration: every atom uses its nearest URL provider. */
export function createQueryAtoms<P extends UseQueryStatesKeysMap>(
  parsers: P,
  { urlKeys, debugLabel = 'query' }: CreateQueryAtomsOptions<P> = {},
): QueryAtoms<P> {
  const initial = parseValues(parsers, urlKeys, new URLSearchParams())
  const cache = new WeakMap<Runtime, { href: string; values: Values<P> }>()
  const queryAtom: QueryAtoms<P>['atom'] = atom<
    Values<P>,
    Parameters<SetValues<P>>,
    Promise<URLSearchParams>
  >(
    (get) => {
      const binding = get(runtimeAtom)
      if (!binding) return initial
      const href = get(binding.runtime.stateAtom)
      const previous = cache.get(binding.runtime)
      if (previous?.href === href) return previous.values
      const values = parseValues(parsers, urlKeys, new URL(href).searchParams, previous?.values)
      cache.set(binding.runtime, { href, values })
      return values
    },
    (get, set, update, options) => {
      const binding = get(runtimeAtom)
      if (!binding) throw new Error('[nuqs-jotai] Missing QueryStateProvider')
      return binding.runtime.write(
        () => {
          const patch = typeof update === 'function' ? update(get(queryAtom)) : update
          return prepareUpdate(parsers, urlKeys, patch, binding.defaults, options)
        },
        { set },
      )
    },
  )
  queryAtom.debugLabel = debugLabel
  function forKey<K extends keyof P>(key: K): QueryAtom<Values<P>[K]> {
    const focused = atom<
      Values<P>[K],
      [ValueUpdate<Values<P>[K]>, Options?],
      Promise<URLSearchParams>
    >(
      (get) => get(queryAtom)[key],
      (_get, set, update, options) =>
        set(
          queryAtom,
          (current) => {
            const value =
              typeof update === 'function'
                ? (update as (previous: Values<P>[K]) => Values<P>[K] | null)(current[key])
                : update
            return { [key]: value } as Partial<Values<P>>
          },
          options,
        ),
    )
    focused.debugLabel = `${debugLabel}.${String(key)}`
    return focused
  }
  const errorAtom = atom((get) => {
    const binding = get(runtimeAtom)
    return binding ? get(binding.runtime.errorAtom) : null
  })
  errorAtom.debugLabel = `${debugLabel}.error`
  return {
    atom: queryAtom,
    atoms: Object.fromEntries(
      Object.keys(parsers).map((key) => [key, forKey(key)]),
    ) as QueryAtoms<P>['atoms'],
    errorAtom,
  }
}

type ValueUpdate<T> = T | null | ((previous: T) => T | null)

/** One provider per URL: preserve parent application atoms and share one queue. */
export function QueryStateProvider({
  adapter,
  options = {},
  children,
}: {
  adapter: QueryAdapter
  options?: Options
  children: ReactNode
}) {
  const [binding] = useState(() => ({ runtime: createQueryRuntime(adapter), defaults: options }))
  const { runtime } = binding
  return (
    <ScopeProvider
      atoms={[[runtimeAtom, binding], runtime.stateAtom, runtime.errorAtom]}
      name="QueryState"
    >
      <RuntimeConnection runtime={runtime}>{children}</RuntimeConnection>
    </ScopeProvider>
  )
}

function RuntimeConnection({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  const store = useStore()
  // Insertion cleanup marks actual removal; layout replay only reconnects.
  useInsertionEffect(() => () => runtime.dispose(), [runtime])
  useBrowserLayoutEffect(() => runtime.connect(store), [runtime, store])
  return children
}
