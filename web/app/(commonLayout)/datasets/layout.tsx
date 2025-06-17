'use client'

import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const router = useRouter()

  useEffect(() => {
    if (!isCurrentWorkspaceEditor && !isCurrentWorkspaceDatasetOperator)
      router.replace('/apps')
  }, [isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, router])

  if (!isCurrentWorkspaceEditor && !isCurrentWorkspaceDatasetOperator)
    return <Loading type='app' />
  return (
    <ExternalKnowledgeApiProvider>
      <ExternalApiPanelProvider>
        {children}
      </ExternalApiPanelProvider>
    </ExternalKnowledgeApiProvider>
  )
}
