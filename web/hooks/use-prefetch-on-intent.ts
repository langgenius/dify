'use client'

import { useCallback, useMemo, useState } from 'react'

/**
 * Holds a `<Link>` back from prefetching until the user shows intent.
 *
 * App Router links prefetch as soon as they enter the viewport, so a grid of
 * cards prefetches one route per visible card at once and each of those costs a
 * server render. Passing `prefetch={false}` outright would also disable the
 * hover prefetch that makes a real click feel instant, so this flips the link
 * back to the default behaviour the first time it is hovered or focused.
 *
 * Spread the result over the link:
 *
 * ```tsx
 * const prefetchOnIntent = usePrefetchOnIntent()
 * <Link href={href} {...prefetchOnIntent}>…</Link>
 * ```
 */
export function usePrefetchOnIntent() {
  const [hasIntent, setHasIntent] = useState(false)
  const markIntent = useCallback(() => setHasIntent(true), [])

  return useMemo(
    () => ({
      prefetch: hasIntent ? null : (false as const),
      onFocus: markIntent,
      onMouseEnter: markIntent,
    }),
    [hasIntent, markIntent],
  )
}
