'use client'

import type { PropsWithChildren } from 'react'
import { useAtomValueRawSync } from 'jotai/react'
import { useEffect } from 'react'
import { usePathname, useSearchParams } from '@/next/navigation'
import AppNotAccessible from './page'
import {
  appAccessErrorAtom,
  appAccessStore,
  captureAppAccessScope,
  getAppAccessScopeKey,
} from './state'

export default function AppAccessBoundary({ children }: PropsWithChildren) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const denial = useAtomValueRawSync(appAccessErrorAtom, { store: appAccessStore })
  const scopeKey = getAppAccessScopeKey(
    pathname,
    search,
    typeof window === 'undefined' ? undefined : window.location.origin,
  )

  // Stay mounted in the root layout to observe leaving application routes, even
  // when the next page makes no request that would otherwise reset the scope.
  useEffect(() => {
    captureAppAccessScope()
  }, [pathname, search])

  if (denial && denial.scope.key === scopeKey)
    return <AppNotAccessible clientIp={denial.clientIp} />

  return children
}
