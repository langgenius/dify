'use client'

import type { NextRouteParams } from './atoms'
import { useIsomorphicLayoutEffect } from 'foxact/use-isomorphic-layout-effect'
import { useSetAtom } from 'jotai'
import { useParams, usePathname } from '@/next/navigation'
import {
  setNextRouteStateAtom,
} from './atoms'

export function NextRouteStateBridge() {
  const pathname = usePathname()
  const params = useParams<NextRouteParams>()
  const setNextRouteState = useSetAtom(setNextRouteStateAtom)

  useIsomorphicLayoutEffect(() => {
    setNextRouteState({
      pathname,
      params,
    })
  }, [params, pathname, setNextRouteState])

  return null
}
