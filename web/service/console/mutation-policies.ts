import type { CreateRouterUtilsOptions, RouterUtils } from '@orpc/tanstack-query'
import type { ConsoleClient } from './index'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

const MUTATION_CALLBACKS = ['onMutate', 'onSuccess', 'onError', 'onSettled'] as const

type MutationCallbackName = (typeof MUTATION_CALLBACKS)[number]
type MutationCallback = (...args: unknown[]) => unknown
type MutationCallbacks = Partial<Record<MutationCallbackName, MutationCallback>>
type PolicyTree = { [segment: string]: unknown }

// Index of the `onMutate` result in each callback's arguments.
const ON_MUTATE_RESULT_INDEX = { onSuccess: 2, onError: 2, onSettled: 3 } as const

/** Holds both results when the policy and the caller each define `onMutate`. */
class ComposedMutateResult {
  readonly policy: unknown
  readonly caller: unknown

  constructor(policy: unknown, caller: unknown) {
    this.policy = policy
    this.caller = caller
  }
}

function isObject(value: unknown): value is PolicyTree {
  return typeof value === 'object' && value !== null
}

function callbackOf(options: object, name: MutationCallbackName) {
  const callback = (options as MutationCallbacks)[name]
  return typeof callback === 'function' ? callback : undefined
}

function withOwnMutateResult(
  name: Exclude<MutationCallbackName, 'onMutate'>,
  args: unknown[],
  side: 'policy' | 'caller',
) {
  const index = ON_MUTATE_RESULT_INDEX[name]
  const result = args[index]
  if (!(result instanceof ComposedMutateResult)) return args
  const next = [...args]
  next[index] = result[side]
  return next
}

/** Starts a callback now and turns a synchronous throw into a rejection. */
function settle(callback: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(callback())
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Runs a procedure's policy callbacks together with the caller's. `onMutate` runs
 * the policy first, so its query cancellation lands before the caller's optimistic
 * write. `onSuccess`, `onError`, and `onSettled` start both at once, so caller
 * feedback (toasts, navigation, locale switches) does not wait for a refetch, and
 * the mutation stays pending until both finish. `meta` merges by key, the caller's
 * value winning. Other options keep oRPC's shallow merge: the caller's value wins.
 */
export function composeMutationOptions<TOptions extends object>(
  policy: object | undefined,
  options: TOptions,
): TOptions {
  if (!policy) return options
  const composed: Record<string, unknown> = { ...(options as Record<string, unknown>) }
  // A caller's `meta` (an error message, say) must not drop the policy's invalidation flags.
  const policyMeta = (policy as { meta?: unknown }).meta
  const callerMeta = (options as { meta?: unknown }).meta
  if (isObject(policyMeta) && isObject(callerMeta)) composed.meta = { ...policyMeta, ...callerMeta }
  const policyMutate = callbackOf(policy, 'onMutate')
  const callerMutate = callbackOf(options, 'onMutate')
  const splitMutateResult = Boolean(policyMutate && callerMutate)

  for (const name of MUTATION_CALLBACKS) {
    const policyCallback = callbackOf(policy, name)
    const callerCallback = callbackOf(options, name)
    if (!policyCallback || !callerCallback) {
      if (policyCallback) composed[name] = policyCallback
      continue
    }
    if (name === 'onMutate') {
      composed[name] = async (...args: unknown[]) =>
        new ComposedMutateResult(await policyCallback(...args), await callerCallback(...args))
      continue
    }
    composed[name] = async (...args: unknown[]) => {
      // Wait for both even when one rejects, so the mutation never settles while
      // the other side is still refreshing the cache.
      const results = await Promise.allSettled([
        settle(() =>
          policyCallback(...(splitMutateResult ? withOwnMutateResult(name, args, 'policy') : args)),
        ),
        settle(() =>
          callerCallback(...(splitMutateResult ? withOwnMutateResult(name, args, 'caller') : args)),
        ),
      ])
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
  }

  if (splitMutateResult) {
    // Callbacks only one side defines still receive that side's `onMutate` result.
    for (const name of ['onSuccess', 'onError', 'onSettled'] as const) {
      const policyCallback = callbackOf(policy, name)
      const callerCallback = callbackOf(options, name)
      if (policyCallback && callerCallback) continue
      const callback = policyCallback ?? callerCallback
      const side = policyCallback ? 'policy' : 'caller'
      if (callback)
        composed[name] = (...args: unknown[]) => callback(...withOwnMutateResult(name, args, side))
    }
  }

  return composed as TOptions
}

/**
 * Wraps oRPC router utils so `mutationOptions()` always composes the procedure's
 * policy callbacks with the caller's instead of letting the caller replace them.
 * oRPC merges `experimental_defaults` shallowly, so without this a call-site
 * `onSuccess` silently drops the shared cache policy.
 */
export function withMutationPolicies<TUtils extends object>(
  utils: TUtils,
  policies: unknown,
): TUtils {
  if (!isObject(policies)) return utils
  return new Proxy(utils, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (typeof property !== 'string') return value
      if (property === 'mutationOptions' && typeof value === 'function') {
        const policy = policies.mutationOptions
        if (!isObject(policy)) return value
        return (options: object = {}) =>
          (value as (options: object) => unknown)(composeMutationOptions(policy, options))
      }
      const nested = policies[property]
      if (isObject(nested) && (typeof value === 'function' || isObject(value)))
        return withMutationPolicies(value, nested)
      return value
    },
  })
}

/**
 * `createTanstackQueryUtils` whose mutation policies in `experimental_defaults`
 * always run, whatever callbacks a call site passes.
 */
export function createPolicyQueryUtils(
  client: ConsoleClient,
  options: CreateRouterUtilsOptions<ConsoleClient>,
): RouterUtils<ConsoleClient> {
  return withMutationPolicies(
    createTanstackQueryUtils(client, options),
    options.experimental_defaults,
  )
}
