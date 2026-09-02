'use client'

import type { WritableAtom } from 'jotai'
import type { Options, SetValues, UseQueryStatesKeysMap, UseQueryStatesOptions, Values } from 'nuqs'
import type { ReactElement, ReactNode } from 'react'
import { atom, useStore } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useQueryStates } from 'nuqs'
import { useEffect, useLayoutEffect, useMemo } from 'react'

const queryAtomsInternals: unique symbol = Symbol('nuqs-jotai.internals')
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type QueryAtomsBinding<Parsers extends UseQueryStatesKeysMap> = {
  values: Values<Parsers>
  setValues: SetValues<Parsers> | null
}

type QueryAtomsPatch<Parsers extends UseQueryStatesKeysMap> = Partial<{
  [Key in keyof Values<Parsers>]: Values<Parsers>[Key] | null
}> | null

type QueryAtomsInternals<Parsers extends UseQueryStatesKeysMap> = {
  bindingAtom: WritableAtom<QueryAtomsBinding<Parsers>, [QueryAtomsBinding<Parsers>], void>
  parsers: Parsers
  urlKeys: UseQueryStatesOptions<Parsers>['urlKeys'] | undefined
}

export type QueryAtom<Value> = WritableAtom<
  Value,
  [update: Value | null | ((previous: Value) => Value | null), options?: Options],
  Promise<URLSearchParams>
>

export type QueryAtoms<Parsers extends UseQueryStatesKeysMap> = {
  readonly atom: WritableAtom<
    Values<Parsers>,
    Parameters<SetValues<Parsers>>,
    Promise<URLSearchParams>
  >
  readonly atoms: {
    readonly [Key in keyof Parsers]: QueryAtom<Values<Parsers>[Key]>
  }
  readonly [queryAtomsInternals]: QueryAtomsInternals<Parsers>
}

export type CreateQueryAtomsOptions<Parsers extends UseQueryStatesKeysMap> = {
  urlKeys?: UseQueryStatesOptions<Parsers>['urlKeys']
  debugLabel?: string
}

export type NuqsJotaiBridgeProps<Parsers extends UseQueryStatesKeysMap> = {
  config: QueryAtoms<Parsers>
  options?: Omit<Partial<UseQueryStatesOptions<Parsers>>, 'urlKeys'>
  children: ReactNode
}

/**
 * Creates a composite query atom and one focused atom per parser key.
 *
 * nuqs remains the owner of URL parsing and writes. The atoms expose that
 * state to a Jotai graph and remain inert until NuqsJotaiBridge is mounted.
 */
export function createQueryAtoms<Parsers extends UseQueryStatesKeysMap>(
  parsers: Parsers,
  { urlKeys, debugLabel = 'nuqs' }: CreateQueryAtomsOptions<Parsers> = {},
): QueryAtoms<Parsers> {
  const bindingAtom = atom<QueryAtomsBinding<Parsers>>({
    values: getInitialValues(parsers),
    setValues: null,
  })
  bindingAtom.debugLabel = `${debugLabel}.binding`

  const queryAtom = atom<Values<Parsers>, Parameters<SetValues<Parsers>>, Promise<URLSearchParams>>(
    (get) => get(bindingAtom).values,
    (get, set, update, options) => {
      const binding = get(bindingAtom)
      if (binding.setValues === null) {
        throw new Error(
          '[nuqs-jotai] Cannot update query atoms before mounting their NuqsJotaiBridge',
        )
      }
      const requested = typeof update === 'function' ? update(binding.values) : update
      const values = applyUpdate(parsers, binding.values, requested)
      set(bindingAtom, { ...binding, values })
      return binding.setValues(requested, options)
    },
  )
  queryAtom.debugLabel = debugLabel

  function createQueryAtomForKey<Key extends keyof Parsers>(
    key: Key,
  ): QueryAtom<Values<Parsers>[Key]> {
    const queryAtomForKey = atom<
      Values<Parsers>[Key],
      [
        update:
          | Values<Parsers>[Key]
          | null
          | ((previous: Values<Parsers>[Key]) => Values<Parsers>[Key] | null),
        options?: Options,
      ],
      Promise<URLSearchParams>
    >(
      (get) => get(queryAtom)[key] as Values<Parsers>[Key],
      (get, set, update, options) => {
        const previous = get(queryAtom)[key] as Values<Parsers>[Key]
        const value =
          typeof update === 'function'
            ? (update as (previous: Values<Parsers>[Key]) => Values<Parsers>[Key] | null)(previous)
            : update
        return set(queryAtom, { [key]: value } as QueryAtomsPatch<Parsers>, options)
      },
    )
    queryAtomForKey.debugLabel = `${debugLabel}.${String(key)}`
    return queryAtomForKey
  }

  const queryAtoms = Object.fromEntries(
    (Object.keys(parsers) as Array<keyof Parsers>).map((key) => [key, createQueryAtomForKey(key)]),
  ) as QueryAtoms<Parsers>['atoms']

  return {
    atom: queryAtom,
    atoms: queryAtoms,
    [queryAtomsInternals]: {
      bindingAtom,
      parsers,
      urlKeys,
    },
  }
}

/**
 * Bridges authoritative nuqs values into an isolated Jotai binding scope.
 */
export function NuqsJotaiBridge<Parsers extends UseQueryStatesKeysMap>({
  config,
  options,
  children,
}: NuqsJotaiBridgeProps<Parsers>): ReactElement {
  const { bindingAtom, parsers, urlKeys } = config[queryAtomsInternals]
  const [values, setValues] = useQueryStates(parsers, {
    ...options,
    urlKeys,
  })
  const binding = useMemo(() => ({ values, setValues }), [setValues, values])

  return (
    <ScopeProvider atoms={[[bindingAtom, binding]]} name="NuqsJotaiBridge">
      <QueryBindingSync binding={binding} bindingAtom={bindingAtom}>
        {children}
      </QueryBindingSync>
    </ScopeProvider>
  )
}

function QueryBindingSync<Parsers extends UseQueryStatesKeysMap>({
  binding,
  bindingAtom,
  children,
}: {
  binding: QueryAtomsBinding<Parsers>
  bindingAtom: QueryAtomsInternals<Parsers>['bindingAtom']
  children: ReactNode
}) {
  const store = useStore()

  useBrowserLayoutEffect(() => {
    return () => {
      const current = store.get(bindingAtom)
      store.set(bindingAtom, { ...current, setValues: null })
    }
  }, [bindingAtom, store])

  useBrowserLayoutEffect(() => {
    store.set(bindingAtom, binding)
  }, [binding, bindingAtom, store])

  return children
}

function getInitialValues<Parsers extends UseQueryStatesKeysMap>(
  parsers: Parsers,
): Values<Parsers> {
  return Object.fromEntries(
    Object.entries(parsers).map(([key, parser]) => [key, parser.defaultValue ?? null]),
  ) as Values<Parsers>
}

function applyUpdate<Parsers extends UseQueryStatesKeysMap>(
  parsers: Parsers,
  current: Values<Parsers>,
  requested: QueryAtomsPatch<Parsers>,
): Values<Parsers> {
  const patch = requested ?? Object.fromEntries(Object.keys(parsers).map((key) => [key, null]))
  const patchRecord = patch as Partial<Record<keyof Parsers, unknown>>
  let hasChanged = false
  const next = { ...current }
  const nextRecord = next as Record<keyof Parsers, unknown>
  for (const key of Object.keys(parsers) as Array<keyof Parsers>) {
    const parser = parsers[key]
    if (!parser) continue
    const value = patchRecord[key]
    if (value === undefined) continue
    const resolved = value ?? parser.defaultValue ?? null
    if (!Object.is(nextRecord[key], resolved)) {
      nextRecord[key] = resolved
      hasChanged = true
    }
  }
  return hasChanged ? next : current
}
