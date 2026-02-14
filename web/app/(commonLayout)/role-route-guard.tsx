'use client'

import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'

const datasetOperatorRedirectRoutes = ['/apps', '/app', '/explore', '/tools'] as const

const isPathUnderRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

export default function RoleRouteGuard({ children }: { children: ReactNode }) {
  const { isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const pathname = usePathname()
  const router = useRouter()
  const shouldGuardRoute = datasetOperatorRedirectRoutes.some(route => isPathUnderRoute(pathname, route))
  const shouldRedirect = shouldGuardRoute && !isLoadingCurrentWorkspace && isCurrentWorkspaceDatasetOperator

  useEffect(() => {
    if (shouldRedirect)
      router.replace('/datasets')
  }, [shouldRedirect, router])

  // Block rendering only for guarded routes to avoid permission flicker.
  if (shouldGuardRoute && isLoadingCurrentWorkspace)
    return <Loading type="app" />

  if (shouldRedirect)
    return null

  return <>{children}</>
}
