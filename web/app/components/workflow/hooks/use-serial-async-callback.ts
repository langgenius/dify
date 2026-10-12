import { useRefWithInit } from '@langgenius/dify-ui/use-ref-with-init'
import { useCallback } from 'react'

export const useSerialAsyncCallback = <Args extends any[], Result = void>(
  fn: (...args: Args) => Promise<Result> | Result,
  shouldSkip?: () => boolean,
) => {
  const queueRef = useRefWithInit<Promise<unknown>>(() => Promise.resolve())

  return useCallback(
    (...args: Args) => {
      if (shouldSkip?.()) return Promise.resolve(undefined as Result)

      const lastPromise = queueRef.current.catch(() => undefined)
      const nextPromise = lastPromise.then(() => fn(...args))
      queueRef.current = nextPromise

      return nextPromise
    },
    [fn, shouldSkip, queueRef],
  )
}
