import React from 'react'
import ExternalKnowledgeBaseConnector from '@/app/components/datasets/external-knowledge-base/connector'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'
import { ExternalApiPanelProvider } from '@/context/external-api-panel-context'

const ExternalKnowledgeBaseCreation = async () => {
  return (
    <ExternalKnowledgeApiProvider>
      <ExternalApiPanelProvider>
        <ExternalKnowledgeBaseConnector />
      </ExternalApiPanelProvider>
    </ExternalKnowledgeApiProvider>
  )
}

export default ExternalKnowledgeBaseCreation
