'use client'

import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import Loading from '@/app/components/base/loading'
import { redirect, usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/client'

const datasetOperatorRedirectRoutes = ['/apps', '/app', '/snippets', '/explore', '/tools'] as const

const isPathUnderRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

export default function RoleRouteGuard({ children }: { children: ReactNode }) {
  const currentWorkspaceRoleQuery = useQuery(consoleQuery.workspaces.current.post.queryOptions({
    select: workspace => workspace.role,
  }))
  const pathname = usePathname()
  const shouldGuardRoute = datasetOperatorRedirectRoutes.some(route => isPathUnderRoute(pathname, route))
  const shouldRedirect = shouldGuardRoute && !currentWorkspaceRoleQuery.isPending && currentWorkspaceRoleQuery.data === 'dataset_operator'

  // Block rendering only for guarded routes to avoid permission flicker.
  if (shouldGuardRoute && currentWorkspaceRoleQuery.isPending)
    return <Loading type="app" />

  if (shouldRedirect)
    redirect('/datasets')

  return <>{children}</>
}
