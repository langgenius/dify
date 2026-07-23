import type { Mutation, MutationFunctionContext } from '@tanstack/react-query'

const SHARED_MUTATION_SUCCESS_META_KEY = 'difySharedMutationSuccess'

type SharedMutationSuccess = (
  data: unknown,
  variables: unknown,
  onMutateResult: unknown,
  context: MutationFunctionContext,
) => Promise<unknown> | unknown

function isSharedMutationSuccess(value: unknown): value is SharedMutationSuccess {
  return typeof value === 'function'
}

export function createSharedMutationSuccessOptions(onSuccess: SharedMutationSuccess) {
  return {
    meta: { [SHARED_MUTATION_SUCCESS_META_KEY]: onSuccess },
    onSuccess,
  }
}

// MutationCache preserves this shared default when a caller supplies its own onSuccess handler.
export function runOverriddenSharedMutationSuccess(
  data: unknown,
  variables: unknown,
  onMutateResult: unknown,
  mutation: Mutation<unknown, unknown, unknown>,
  context: MutationFunctionContext,
) {
  const sharedOnSuccess = mutation.meta?.[SHARED_MUTATION_SUCCESS_META_KEY]
  if (!isSharedMutationSuccess(sharedOnSuccess) || mutation.options.onSuccess === sharedOnSuccess)
    return

  return sharedOnSuccess(data, variables, onMutateResult, context)
}
