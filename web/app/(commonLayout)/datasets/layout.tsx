'use client'

import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'
import { useRouter } from '@/next/navigation'
import { hasPermission } from '@/utils/permission'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const { currentWorkspace, isLoadingCurrentWorkspace, isLoadingWorkspacePermissionKeys, workspacePermissionKeys } = useAppContext()
  const router = useRouter()
  const isLoadingAccess = isLoadingCurrentWorkspace || !!isLoadingWorkspacePermissionKeys
  const canAccessDatasetsPage = hasPermission(workspacePermissionKeys, 'page.datasets.access')
  const shouldRedirect = !isLoadingAccess
    && currentWorkspace.id
    && !canAccessDatasetsPage

  useEffect(() => {
    if (shouldRedirect)
      router.replace('/apps')
  }, [shouldRedirect, router])

  if (isLoadingAccess || !currentWorkspace.id)
    return <Loading type="app" />

  if (shouldRedirect) {
    return null
  }

  return (
    <ExternalKnowledgeApiProvider>
      <ExternalApiPanelProvider>
        {children}
      </ExternalApiPanelProvider>
    </ExternalKnowledgeApiProvider>
  )
}
