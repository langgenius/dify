'use client'

import { useEffect } from 'react'
import { useAppContext } from '@/context/app-context'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'
import { useRouter } from '@/next/navigation'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, currentWorkspace, isLoadingCurrentWorkspace } = useAppContext()
  const router = useRouter()
  const isWorkspaceReady = !isLoadingCurrentWorkspace && !!currentWorkspace.id
  const shouldRedirect = isWorkspaceReady && !(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator)

  useEffect(() => {
    if (shouldRedirect)
      router.replace('/apps')
  }, [shouldRedirect, router])

  if (!isWorkspaceReady || shouldRedirect) {
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
