'use client'

import type { ReactNode } from 'react'
import { QueryStateProvider as UrlStateProvider } from 'nuqs-jotai'
import { createBrowserQueryAdapter } from 'nuqs-jotai/browser'
import { startTransition, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'

/** One URL owner for the app, independent of feature and page-local scopes. */
export function QueryStateProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const searchString = search?.toString() ?? ''
  const [session] = useState(() => ({
    pathname,
    adapter: createBrowserQueryAdapter({
      initialUrl: new URL(`${pathname}?${searchString}`, 'http://localhost'),
      refresh(url) {
        // History is already committed. Refresh server data without a second push.
        startTransition(() =>
          router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false }),
        )
      },
    }),
  }))
  // Jotai subscribes in passive effects. Publish after child subscriptions so
  // a page mounted by this navigation cannot miss the new URL snapshot.
  useEffect(() => {
    // A new pathname cancels pending work even before browser history commits.
    const navigated = session.pathname !== pathname
    session.pathname = pathname
    // Vinext commits through saved native history methods, bypassing the
    // adapter wrapper. Reconcile committed search changes without treating
    // our own URL writes as traversals that would cancel a newer draft.
    session.adapter.notifyUrlChange(navigated)
  }, [pathname, searchString, session])
  return <UrlStateProvider adapter={session.adapter}>{children}</UrlStateProvider>
}
