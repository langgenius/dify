'use client'

import type { Atom, WritableAtom } from 'jotai'
import type { Options, SetValues, UseQueryStatesKeysMap, UseQueryStatesOptions, Values } from 'nuqs'
import type { ReactNode } from 'react'
import { atom, useAtomValueRawSync, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { useQueryStates } from 'nuqs'
import { useEffect, useInsertionEffect, useState } from 'react'

const definitionKey = Symbol('nuqs-jotai.definition')
type KeyMap = UseQueryStatesKeysMap
type Binding = {
  write: SetValues<KeyMap>
  refresh: (write: SetValues<KeyMap>) => void
  connect: (write: SetValues<KeyMap>) => () => void
  dispose: () => void
}
type Definition = {
  parsers: KeyMap
  options: Partial<UseQueryStatesOptions<KeyMap>>
  valueAtom: WritableAtom<Values<KeyMap>, [Values<KeyMap>], void>
  bindingAtom: WritableAtom<Binding | null, [Binding | null], void>
}
type Registered = { readonly [definitionKey]: Definition }

export type QueryAtom<Value> = WritableAtom<
  Value,
  [update: Value | null | ((previous: Value) => Value | null), options?: Options],
  Promise<URLSearchParams>
> &
  Registered

export type SearchParamsAtom<P extends KeyMap> = WritableAtom<
  Values<P>,
  Parameters<SetValues<P>>,
  Promise<URLSearchParams>
> &
  Registered

export type SearchParamsOptions<P extends KeyMap> = Options & {
  urlKeys?: UseQueryStatesOptions<P>['urlKeys']
  debugLabel?: string
}

export function atomWithSearchParams<P extends KeyMap>(
  parsers: P,
  { debugLabel = 'query', ...options }: SearchParamsOptions<P> = {},
): SearchParamsAtom<P> {
  const valueAtom = atom<Values<KeyMap>>({})
  const bindingAtom = atom<Binding | null>(null)
  const definition: Definition = { parsers, options, valueAtom, bindingAtom }
  const queryAtom = atom(
    (get) => {
      if (!get(bindingAtom))
        throw new Error('[nuqs-jotai] Register this atom in QueryStateProvider')
      return get(valueAtom) as Values<P>
    },
    (get, _set, ...args: Parameters<SetValues<P>>) => {
      const binding = get(bindingAtom)
      if (!binding) throw new Error('[nuqs-jotai] Register this atom in QueryStateProvider')
      return (binding.write as SetValues<P>)(...args)
    },
  )
  queryAtom.debugLabel = debugLabel
  valueAtom.debugLabel = `${debugLabel}.snapshot`
  bindingAtom.debugLabel = `${debugLabel}.binding`
  return Object.assign(queryAtom, { [definitionKey]: definition })
}

export function atomsWithSearchParams<P extends KeyMap>(
  parsers: P,
  options: SearchParamsOptions<P> = {},
): { readonly [K in keyof P]: QueryAtom<Values<P>[K]> } {
  const group = atomWithSearchParams(parsers, options)
  function forKey<K extends keyof P>(key: K): QueryAtom<Values<P>[K]> {
    const field = atom(
      (get) => get(group)[key],
      (
        _get,
        set,
        update: Values<P>[K] | null | ((previous: Values<P>[K]) => Values<P>[K] | null),
        writeOptions?: Options,
      ) =>
        set(
          group,
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
    field.debugLabel = `${options.debugLabel ?? 'query'}.${String(key)}`
    return Object.assign(field, { [definitionKey]: group[definitionKey] })
  }
  return Object.fromEntries(Object.keys(parsers).map((key) => [key, forKey(key)])) as {
    readonly [K in keyof P]: QueryAtom<Values<P>[K]>
  }
}

export function atomWithSearchParam<P extends KeyMap[string]>(
  key: string,
  parser: P,
  options: Options & { debugLabel?: string } = {},
): QueryAtom<Values<{ value: P }>['value']> {
  const { value } = atomsWithSearchParams(
    { value: parser },
    { ...options, urlKeys: { value: key } },
  )
  value.debugLabel = options.debugLabel ?? key
  return value
}

/** Use Jotai's synchronous subscription for authoritative URL snapshots. */
export function useQueryAtomValue<Value>(queryAtom: Atom<Value>): Value {
  return useAtomValueRawSync(queryAtom)
}

export function useQueryAtom<Value, Args extends unknown[], Result>(
  queryAtom: WritableAtom<Value, Args, Result>,
) {
  return [useQueryAtomValue(queryAtom), useSetAtom(queryAtom)] as const
}

/** No URL scheduler: only hold mount-time commands until nuqs has subscribed. */
function createBinding(): Binding {
  let writer: SetValues<KeyMap> | undefined
  let disposed = false
  const waiting: {
    args: Parameters<SetValues<KeyMap>>
    resolve: (value: URLSearchParams | PromiseLike<URLSearchParams>) => void
    reject: (error: unknown) => void
  }[] = []
  const unavailable = () => new Error('[nuqs-jotai] Cannot write after QueryStateProvider unmounts')
  return {
    write(...args) {
      if (disposed) throw unavailable()
      if (writer && waiting.length === 0) return writer(...args)
      return new Promise((resolve, reject) => waiting.push({ args, resolve, reject }))
    },
    refresh(write) {
      // Only refresh an attached connection. Mount/reveal commands must still
      // wait until nuqs reattaches its passive subscriptions.
      if (writer) writer = write
    },
    connect(write) {
      writer = write
      let active = true
      // Parent and sibling nuqs hooks may not have subscribed yet. Flush held
      // commands after this effect pass, preserving their typed emitter payloads.
      queueMicrotask(() => {
        if (!active || disposed) return
        for (const request of waiting.splice(0)) {
          try {
            request.resolve(write(...request.args))
          } catch (error) {
            request.reject(error)
          }
        }
      })
      return () => {
        active = false
        writer = undefined
      }
    },
    dispose() {
      disposed = true
      writer = undefined
      for (const request of waiting.splice(0)) request.reject(unavailable())
    },
  }
}

/** Mount beneath the framework's NuqsAdapter. Register groups once per URL scope. */
export function QueryStateProvider({
  atoms,
  children,
}: {
  atoms: readonly Registered[]
  children: ReactNode
}) {
  const definitions = [...new Set(atoms.map((queryAtom) => queryAtom[definitionKey]))]
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
