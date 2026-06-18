'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { redirect, usePathname } from '@/next/navigation'

function isPathUnderRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`)
}

export function RoleRouteGuard({ children }: { children: ReactNode }) {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const pathname = usePathname()
  const shouldRedirectAppDeploy = isPathUnderRoute(pathname, '/deployments') && !systemFeatures.enable_app_deploy

  if (shouldRedirectAppDeploy)
    redirect('/apps')

  return <>{children}</>
}
