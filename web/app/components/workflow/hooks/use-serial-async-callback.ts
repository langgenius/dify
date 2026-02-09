import {
  useCallback,
  useEffect,
  useRef,
} from 'react'

export const useSerialAsyncCallback = <Args extends any[], Result = void>(
  fn: (...args: Args) => Promise<Result> | Result,
  shouldSkip?: () => boolean,
) => {
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const fnRef = useRef(fn)
  const shouldSkipRef = useRef(shouldSkip)

  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    shouldSkipRef.current = shouldSkip
  }, [shouldSkip])

  return useCallback((...args: Args) => {
    if (shouldSkipRef.current?.())
      return Promise.resolve(undefined as Result)

    const lastPromise = queueRef.current.catch(() => undefined)
    const nextPromise = lastPromise.then(() => fnRef.current(...args))
    queueRef.current = nextPromise

    return nextPromise
  }, [])
}
