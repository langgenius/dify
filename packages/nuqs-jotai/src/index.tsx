'use client'

import type { WritableAtom } from 'jotai'
import type { Options, SetValues, UseQueryStatesKeysMap, UseQueryStatesOptions, Values } from 'nuqs'
import type { ReactNode } from 'react'
import type { Binding } from './binding'
import { atom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { atomWithLazy, useHydrateAtoms } from 'jotai/utils'
import { useQueryStates } from 'nuqs'
import { useEffect, useInsertionEffect, useState } from 'react'
import { createBinding } from './binding'

const definitionKey = Symbol('nuqs-jotai.definition')
type KeyMap = UseQueryStatesKeysMap
type Definition = {
  parsers: KeyMap
  options: Partial<UseQueryStatesOptions<KeyMap>>
  valueAtom: WritableAtom<Values<KeyMap>, [Values<KeyMap>], void>
  bindingAtom: WritableAtom<Binding, [Binding], void>
}
type Registered = { readonly [definitionKey]: Definition }

export type QueryAtom<Value> = WritableAtom<
  Value,
  [update: Value | null | ((previous: Value) => Value | null), options?: Options],
  Promise<URLSearchParams>
>

export type SearchParamsAtom<P extends KeyMap> = WritableAtom<
  Values<P>,
  Parameters<SetValues<P>>,
  Promise<URLSearchParams>
>

export type SearchParamsOptions<P extends KeyMap> = Options & {
  urlKeys?: UseQueryStatesOptions<P>['urlKeys']
  debugLabel?: string
}

export type QueryGroup<P extends KeyMap> = Registered & {
  readonly atom: SearchParamsAtom<P>
  readonly fields: { readonly [K in keyof P]: QueryAtom<Values<P>[K]> }
}

/** One nuqs hook and snapshot shared by a composite atom and its field atoms. */
export function createQueryGroup<P extends KeyMap>(
  parsers: P,
  { debugLabel = 'query', ...options }: SearchParamsOptions<P> = {},
): QueryGroup<P> {
  const valueAtom = atom<Values<KeyMap>>({})
  const bindingAtom = atomWithLazy<Binding>(() => {
    throw new Error('[nuqs-jotai] Register this group in QueryStateProvider')
  })
  const definition: Definition = { parsers, options, valueAtom, bindingAtom }
  const queryAtom = atom(
    (get) => {
      get(bindingAtom)
      return get(valueAtom) as Values<P>
    },
    (get, _set, ...args: Parameters<SetValues<P>>) => {
      const binding = get(bindingAtom)
      return (binding.write as SetValues<P>)(...args)
    },
  )
  queryAtom.debugLabel = debugLabel
  valueAtom.debugLabel = `${debugLabel}.snapshot`
  bindingAtom.debugLabel = `${debugLabel}.binding`
  function forKey<K extends keyof P>(key: K): QueryAtom<Values<P>[K]> {
    const field = atom(
      (get) => get(queryAtom)[key],
      (
        _get,
        set,
        update: Values<P>[K] | null | ((previous: Values<P>[K]) => Values<P>[K] | null),
        writeOptions?: Options,
      ) =>
        set(
          queryAtom,
          (current) =>
            ({
              [key]:
                typeof update === 'function'
                  ? (update as (previous: Values<P>[K]) => Values<P>[K] | null)(current[key])
                  : update,
            }) as Partial<Values<P>>,
          writeOptions,
        ),
    )
    field.debugLabel = `${debugLabel}.${String(key)}`
    return field
  }
  return {
    atom: queryAtom,
    fields: Object.fromEntries(
      Object.keys(parsers).map((key) => [key, forKey(key)]),
    ) as QueryGroup<P>['fields'],
    [definitionKey]: definition,
  }
}

/** Mount beneath the framework's NuqsAdapter. Register groups once per URL scope. */
export function QueryStateProvider({
  groups,
  children,
}: {
  groups: readonly Registered[]
  children: ReactNode
}) {
  const definitions = [...new Set(groups.map((group) => group[definitionKey]))]
  return (
    <ScopeProvider
      atoms={definitions.flatMap((definition) => [definition.valueAtom, definition.bindingAtom])}
      name="QueryState"
    >
      {definitions.reduceRight<ReactNode>(
        (content, definition) => (
          <Bridge key={definition.valueAtom.toString()} definition={definition}>
            {content}
          </Bridge>
        ),
        children,
      )}
    </ScopeProvider>
  )
}

function Bridge({ definition, children }: { definition: Definition; children: ReactNode }) {
  const [values, write] = useQueryStates(definition.parsers, definition.options)
  const [binding] = useState(createBinding)
  // This scope owns only authoritative nuqs inputs. Never hydrate consumer drafts.
  useHydrateAtoms(
    [
      [definition.valueAtom, values],
      [definition.bindingAtom, binding],
    ],
    { dangerouslyForceHydrate: true },
  )
  useInsertionEffect(() => () => binding.dispose(), [binding])
  // Refresh before descendant layout commands run, without publishing a
  // speculative render's writer or attaching mount/reveal connections early.
  useInsertionEffect(() => binding.refresh(write), [binding, write])
  // Connect after this hook subscribes; held commands wait for the effect pass.
  useEffect(() => binding.connect(write), [binding, write])
  return children
}
