import { toastRequestError } from '@/app/notifications/request-error'

type HookMutationOptions = {
  onError?: (error: Error) => void
  meta?: { errorMessage?: string }
}

type CallMutationOptions = {
  onError?: (error: Error) => void
  [key: string]: unknown
}

/**
 * Wraps a mocked `mutate` so a failure the test reports through the call options reaches the
 * hook-level `onError` first, or the app's global mutation handler when the hook declares none,
 * just as React Query would.
 */
export const routeMockedMutationFailure =
  (
    hookOptions: HookMutationOptions | undefined,
    mutate: (variables: unknown, options?: CallMutationOptions) => unknown,
  ) =>
  (variables: unknown, callOptions?: CallMutationOptions) =>
    mutate(variables, {
      ...callOptions,
      onError: (error: Error) => {
        if (hookOptions?.onError) hookOptions.onError(error)
        else toastRequestError(error, hookOptions?.meta?.errorMessage)
        callOptions?.onError?.(error)
      },
    })

/** The `mutateAsync` counterpart of {@link routeMockedMutationFailure}. */
export const routeMockedMutateAsyncFailure =
  (
    hookOptions: HookMutationOptions | undefined,
    mutateAsync: (variables: unknown) => Promise<unknown>,
  ) =>
  async (variables: unknown) => {
    try {
      return await mutateAsync(variables)
    } catch (error) {
      if (hookOptions?.onError) hookOptions.onError(error as Error)
      else toastRequestError(error, hookOptions?.meta?.errorMessage)
      throw error
    }
  }
