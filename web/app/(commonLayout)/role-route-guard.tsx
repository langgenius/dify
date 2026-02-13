'use client'

import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'

export default function RoleRouteGuard({ children }: { children: ReactNode }) {
  const { isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()
  const pathname = usePathname()
  const router = useRouter()
  const shouldRedirect = !isLoadingCurrentWorkspace
    && currentWorkspace.id
    && isCurrentWorkspaceDatasetOperator
    && !pathname.startsWith('/datasets')

  useEffect(() => {
    if (shouldRedirect)
      router.replace('/datasets')
  }, [shouldRedirect, router])

  if (isLoadingCurrentWorkspace)
    return <Loading type="app" />

  if (shouldRedirect)
    return null

  return <>{children}</>
}
