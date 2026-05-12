'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { usePathname, useRouter } from '@/next/navigation'
import { systemFeaturesQueryOptions } from '@/service/system-features'

const datasetOperatorRedirectRoutes = ['/apps', '/app', '/explore', '/tools'] as const

const isPathUnderRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

export default function RoleRouteGuard({ children }: { children: ReactNode }) {
  const { isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const pathname = usePathname()
  const router = useRouter()
  const shouldGuardRoute = datasetOperatorRedirectRoutes.some(route => isPathUnderRoute(pathname, route))
  const shouldRedirectDatasetOperator = shouldGuardRoute && !isLoadingCurrentWorkspace && isCurrentWorkspaceDatasetOperator
  const shouldRedirectAppDeploy = isPathUnderRoute(pathname, '/deployments') && !systemFeatures.enable_app_deploy
  const shouldRedirect = shouldRedirectDatasetOperator || shouldRedirectAppDeploy
  const redirectPath = shouldRedirectAppDeploy ? '/apps' : '/datasets'

  useEffect(() => {
    if (shouldRedirect)
      router.replace(redirectPath)
  }, [redirectPath, shouldRedirect, router])

  // Block rendering only for guarded routes to avoid permission flicker.
  if (shouldGuardRoute && isLoadingCurrentWorkspace)
    return <Loading type="app" />

  if (shouldRedirect)
    return null

  return <>{children}</>
}
