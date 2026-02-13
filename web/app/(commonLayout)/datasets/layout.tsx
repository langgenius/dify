'use client'

import { useRouter } from 'next/navigation'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, currentWorkspace, isLoadingCurrentWorkspace } = useAppContext()
  const router = useRouter()

  if (isLoadingCurrentWorkspace || !currentWorkspace.id)
    return <Loading type="app" />

  if (!(isCurrentWorkspaceEditor || isCurrentWorkspaceDatasetOperator)) {
    router.replace('/apps')
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
