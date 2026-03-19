'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useAppContext } from '@/context/app-context'
import { usePathname, useRouter } from '@/next/navigation'

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

  if (shouldGuardRoute && isLoadingCurrentWorkspace)
    return null

  if (shouldRedirect)
    return null

  return <>{children}</>
}
