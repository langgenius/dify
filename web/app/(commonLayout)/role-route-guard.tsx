'use client'

import type { ReactNode } from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import Loading from '@/app/components/base/loading'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { redirect, usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/client'

const datasetOperatorRedirectRoutes = ['/', '/apps', '/app', '/deployments', '/snippets', '/roster', '/explore', '/tools', '/integrations'] as const

function isPathUnderRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function RoleRouteGuard({ children }: { children: ReactNode }) {
  const currentWorkspaceRoleQuery = useQuery(consoleQuery.workspaces.current.post.queryOptions({
    select: workspace => workspace.role,
  }))
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const pathname = usePathname()
  const shouldGuardRoute = datasetOperatorRedirectRoutes.some(route => isPathUnderRoute(pathname, route))
  const shouldRedirectDatasetOperator = shouldGuardRoute
    && !currentWorkspaceRoleQuery.isPending
    && currentWorkspaceRoleQuery.data === 'dataset_operator'
  const shouldRedirectAppDeploy = isPathUnderRoute(pathname, '/deployments') && !systemFeatures.enable_app_deploy

  // Block rendering only for guarded routes to avoid permission flicker.
  if (shouldGuardRoute && currentWorkspaceRoleQuery.isPending)
    return <Loading type="app" />

  if (shouldRedirectAppDeploy)
    redirect('/apps')

  if (shouldRedirectDatasetOperator)
    redirect('/datasets')

  return <>{children}</>
}
