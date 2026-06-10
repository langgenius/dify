import * as reactExports from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

// useIsomorphicInsertionEffect
const useInsertionEffect
  = typeof window === 'undefined'
  // useInsertionEffect is only available in React 18+

    ? useEffect
    : reactExports.useInsertionEffect || useLayoutEffect

/**
 * @see https://foxact.skk.moe/use-stable-handler-only-when-you-know-what-you-are-doing-or-you-will-be-fired
 * Similar to useCallback, with a few subtle differences:
 * - The returned function is a stable reference, and will always be the same between renders
 * - No dependency lists required
 * - Properties or state accessed within the callback will always be "current"
 */
// eslint-disable-next-line ts/no-explicit-any
export function useStableHandler<Args extends any[], Result>(
  callback: (...args: Args) => Result,
): typeof callback {
  // Keep track of the latest callback:
  // eslint-disable-next-line ts/no-explicit-any
  const latestRef = useRef<typeof callback>(shouldNotBeInvokedBeforeMount as any)
  useInsertionEffect(() => {
    latestRef.current = callback
  }, [callback])

  return useCallback<typeof callback>((...args) => {
    const fn = latestRef.current
    return fn(...args)
  }, [])
}

/**
 * Render methods should be pure, especially when concurrency is used,
 * so we will throw this error if the callback is called while rendering.
 */
function shouldNotBeInvokedBeforeMount() {
  throw new Error(
    'foxact: the stablized handler cannot be invoked before the component has mounted.',
  )
}
