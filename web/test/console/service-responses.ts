import type { consoleQuery } from '@/service/console'
import { skipToken } from '@tanstack/react-query'

type ResponseHandler = (input: never) => unknown

type QueryOverrides = Partial<
  Record<'queryOptions' | 'infiniteOptions', (options: never) => object>
>

/** Keep generated keys and policies when a scenario supplies custom query functions/options. */
export function withConsoleQueryOverrides(
  query: typeof consoleQuery,
  overrides: Record<string, QueryOverrides>,
): typeof consoleQuery {
  const paths = Object.keys(overrides)
  const wrap = <T extends object>(target: T, path: string): T =>
    new Proxy(target, {
      get(current, property, receiver) {
        const value = Reflect.get(current, property, receiver)
        if (typeof property !== 'string') return value
        const override =
          property === 'queryOptions' || property === 'infiniteOptions'
            ? overrides[path]?.[property]
            : undefined
        if (override) {
          return (options: { input?: unknown } = {}) => {
            const original = (value as (options: unknown) => { queryKey: unknown })(options)
            if (options.input === skipToken) return original
            return { ...original, ...override(options as never), queryKey: original.queryKey }
          }
        }
        const nextPath = path ? `${path}.${property}` : property
        if (paths.some((key) => key === nextPath || key.startsWith(`${nextPath}.`)))
          return wrap(value as object, nextPath)
        return value
      },
    })
  return wrap(query, '')
}

/** Replace transport responses while retaining generated keys/options and real Query observers. */
export function withConsoleResponses(
  query: typeof consoleQuery,
  responses: Record<string, ResponseHandler>,
): typeof consoleQuery {
  const paths = Object.keys(responses)
  const wrap = <T extends object>(target: T, path: string): T =>
    new Proxy(target, {
      get(current, property, receiver) {
        const value = Reflect.get(current, property, receiver)
        if (typeof property !== 'string') return value
        const handler = responses[path]
        if (handler && ['queryOptions', 'infiniteOptions', 'mutationOptions'].includes(property)) {
          return (options: { input?: unknown } = {}) => {
            const originalOptions = (value as (options: unknown) => object)(options)
            if (property === 'mutationOptions')
              return { ...originalOptions, mutationFn: (input: never) => handler(input) }
            if ('queryFn' in originalOptions && originalOptions.queryFn === skipToken)
              return originalOptions
            return {
              ...originalOptions,
              queryFn: ({ pageParam }: { pageParam?: unknown }) =>
                handler(
                  (typeof options.input === 'function'
                    ? options.input(pageParam)
                    : options.input) as never,
                ),
            }
          }
        }
        const nextPath = path ? `${path}.${property}` : property
        if (paths.some((key) => key === nextPath || key.startsWith(`${nextPath}.`)))
          return wrap(value as object, nextPath)
        return value
      },
    })
  return wrap(query, '')
}

/** Stub selected generated client operations while keeping service hooks and mutations real. */
export function withConsoleClientResponses(
  client: typeof import('@/service/console').consoleClient,
  responses: Record<string, ResponseHandler>,
): typeof client {
  const paths = Object.keys(responses)
  const wrap = <T extends object>(target: T, path: string): T =>
    new Proxy(target, {
      get(current, property, receiver) {
        if (typeof property !== 'string') return Reflect.get(current, property, receiver)
        const nextPath = path ? `${path}.${property}` : property
        if (responses[nextPath]) return responses[nextPath]
        const value = Reflect.get(current, property, receiver)
        if (paths.some((key) => key.startsWith(`${nextPath}.`)))
          return wrap(value as object, nextPath)
        return value
      },
    })
  return wrap(client, '')
}
