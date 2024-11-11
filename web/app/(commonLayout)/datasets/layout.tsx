'use client'

import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'

export default function DatasetsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ExternalKnowledgeApiProvider>
      <ExternalApiPanelProvider>
        {children}
      </ExternalApiPanelProvider>
    </ExternalKnowledgeApiProvider>
  )
}
