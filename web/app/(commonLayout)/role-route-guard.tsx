'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { usePathname, useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'

const pageRoutePermissionGuards = [
  { route: '/explore', permissionKey: 'page.explore.access' },
  { route: '/datasets', permissionKey: 'page.datasets.access' },
  { route: '/tools', permissionKey: 'page.tool.access' },
] as const

const isPathUnderRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

const getPageRoutePermissionGuard = (pathname: string) => {
  return pageRoutePermissionGuards.find(({ route }) => isPathUnderRoute(pathname, route))
}

const getRedirectPath = (pathname: string, workspacePermissionKeys: string[]) => {
  if (!isPathUnderRoute(pathname, '/datasets') && hasPermission(workspacePermissionKeys, 'page.datasets.access'))
    return '/datasets'

  return '/apps'
}

export default function RoleRouteGuard({ children }: { children: ReactNode }) {
  const { isLoadingCurrentWorkspace, isLoadingWorkspacePermissionKeys, workspacePermissionKeys } = useAppContext()
  const pathname = usePathname()
  const router = useRouter()
  const routePermissionGuard = getPageRoutePermissionGuard(pathname)
  const shouldGuardRoute = !!routePermissionGuard
  const isLoadingAccess = isLoadingCurrentWorkspace || !!isLoadingWorkspacePermissionKeys
  const canAccessRoute = routePermissionGuard
    ? hasPermission(workspacePermissionKeys, routePermissionGuard.permissionKey)
    : true
  const shouldRedirect = shouldGuardRoute && !isLoadingAccess && !canAccessRoute
  const redirectPath = getRedirectPath(pathname, workspacePermissionKeys)

  useEffect(() => {
    if (shouldRedirect)
      router.replace(redirectPath)
  }, [shouldRedirect, redirectPath, router])

  // Block rendering only for guarded routes to avoid permission flicker.
  if (shouldGuardRoute && isLoadingAccess)
    return <Loading type="app" />

  if (shouldRedirect)
    return null

  return <>{children}</>
}
