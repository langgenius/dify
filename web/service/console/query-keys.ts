import type { RouterUtils } from '@orpc/tanstack-query'
import type { ConsoleClient } from './index'
import { createGeneralUtils, generateOperationKey } from '@orpc/tanstack-query'

type KeyRouter<T> = Pick<T, Extract<keyof T, 'key' | 'queryKey'>> & {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: KeyRouter<T[K]>
}
export type ConsoleQueryKeys = KeyRouter<RouterUtils<ConsoleClient>>

/** Cache policies need keys, never a client or its operation/validator registry. */
function keys(path: string[]): object {
  return new Proxy(
    {
      key: createGeneralUtils(path).key,
      queryKey: (options: { input?: unknown; queryKey?: readonly unknown[] } = {}) =>
        options.queryKey ?? generateOperationKey(path, { type: 'query', input: options.input }),
    },
    {
      get(target, property) {
        if (typeof property !== 'string' || Object.hasOwn(target, property))
          return Reflect.get(target, property)
        if (property === 'then') return undefined
        return keys([...path, property])
      },
    },
  )
}

// The path-only proxy implements the same oRPC key helpers at every router level.
export const consoleKeys = /* @__PURE__ */ keys(['console']) as ConsoleQueryKeys
