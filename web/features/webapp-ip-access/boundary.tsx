'use client'

import type { PropsWithChildren } from 'react'
import { useAtomValueRawSync } from 'jotai/react'
import { useEffect } from 'react'
import { usePathname, useSearchParams } from '@/next/navigation'
import AccessRestricted from './access-restricted'
import {
  captureIpAccessScope,
  getIpAccessScopeKey,
  ipAccessDeniedAtom,
  ipAccessStore,
} from './state'

export default function IpAccessBoundary({ children }: PropsWithChildren) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const denial = useAtomValueRawSync(ipAccessDeniedAtom, { store: ipAccessStore })
  const scopeKey = getIpAccessScopeKey(
    pathname,
    search,
    typeof window === 'undefined' ? undefined : window.location.origin,
  )

  // Stay mounted in the root layout to observe leaving public routes, even
  // when the next page makes no request that would otherwise reset the scope.
  useEffect(() => {
    captureIpAccessScope()
  }, [pathname, search])

  if (denial && denial.scope.key === scopeKey)
    return <AccessRestricted clientIp={denial.clientIp} />

  return children
}
