'use client'

import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAppContext } from '@/context/app-context'

export default function RoleRouteGuard({ children }: { children: ReactNode }) {
  const { isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace, currentWorkspace } = useAppContext()
  const pathname = usePathname()
  const router = useRouter()

  if (
    !isLoadingCurrentWorkspace
    && currentWorkspace.id
    && isCurrentWorkspaceDatasetOperator
    && !pathname.startsWith('/datasets')
  ) {
    router.replace('/datasets')
    return null
  }

  return <>{children}</>
}
