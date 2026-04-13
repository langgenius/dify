import {
  useCallback,
  useRef,
} from 'react'

export const useSerialAsyncCallback = <Args extends any[], Result = void>(
  fn: (...args: Args) => Promise<Result> | Result,
  shouldSkip?: () => boolean,
) => {
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())

  return useCallback((...args: Args) => {
    if (shouldSkip?.())
      return Promise.resolve(undefined as Result)

    const lastPromise = queueRef.current.catch(() => undefined)
    const nextPromise = lastPromise.then(() => fn(...args))
    queueRef.current = nextPromise

    return nextPromise
  }, [fn, shouldSkip])
}
