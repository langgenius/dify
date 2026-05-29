'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { usePathname, useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'

type PageRoutePermissionGuard = {
  route: string
  permissionKey: string | string[]
}

const pageRoutePermissionGuards: PageRoutePermissionGuard[] = [
  { route: '/explore', permissionKey: 'app_library.access' },
  { route: '/tools', permissionKey: ['tool.manage', 'mcp.manage'] },
]

const isPathUnderRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

const getPageRoutePermissionGuard = (pathname: string) => {
  return pageRoutePermissionGuards.find(({ route }) => isPathUnderRoute(pathname, route))
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

  useEffect(() => {
    if (shouldRedirect)
      router.replace('/apps')
  }, [shouldRedirect, router])

  // Block rendering only for guarded routes to avoid permission flicker.
  if (shouldGuardRoute && isLoadingAccess)
    return <Loading type="app" />

  if (shouldRedirect)
    return null

  return <>{children}</>
}
