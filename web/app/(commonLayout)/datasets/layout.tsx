'use client'

import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  const { isCurrentWorkspaceEditor } = useAppContext()
  const router = useRouter()

  useEffect(() => {
    if (!isCurrentWorkspaceEditor)
      router.replace('/apps')
  }, [isCurrentWorkspaceEditor, router])

  if (!isCurrentWorkspaceEditor)
    return <Loading type='app' />
  return (
    <ExternalKnowledgeApiProvider>
      <ExternalApiPanelProvider>
        {children}
      </ExternalApiPanelProvider>
    </ExternalKnowledgeApiProvider>
  )
}
