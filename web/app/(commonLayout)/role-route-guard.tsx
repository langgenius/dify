'use client'

import type { ReactNode } from 'react'
import { useAppContext } from '@/context/app-context'
import { redirect, usePathname } from '@/next/navigation'

const datasetOperatorRedirectRoutes = ['/apps', '/app', '/explore', '/tools'] as const

const isPathUnderRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

export default function RoleRouteGuard({ children }: { children: ReactNode }) {
  const { isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const pathname = usePathname()
  const shouldGuardRoute = datasetOperatorRedirectRoutes.some(route => isPathUnderRoute(pathname, route))
  const shouldRedirect = shouldGuardRoute && !isLoadingCurrentWorkspace && isCurrentWorkspaceDatasetOperator

  if (shouldRedirect)
    return redirect('/datasets')

  return <>{children}</>
}
