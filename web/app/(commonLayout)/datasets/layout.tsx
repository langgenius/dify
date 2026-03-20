'use client'

import { useAppContext } from '@/context/app-context'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'
import { redirect } from '@/next/navigation'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, currentWorkspace, isLoadingCurrentWorkspace } = useAppContext()
  const isWorkspaceReady = !isLoadingCurrentWorkspace && !!currentWorkspace.id
  const shouldRedirect = isWorkspaceReady && !(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator)

  if (shouldRedirect) {
    return redirect('/apps')
  }

  return (
    <ExternalKnowledgeApiProvider>
      <ExternalApiPanelProvider>
        {children}
      </ExternalApiPanelProvider>
    </ExternalKnowledgeApiProvider>
  )
}
