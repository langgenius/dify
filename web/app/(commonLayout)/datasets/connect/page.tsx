import React from 'react'
import ExternalKnowledgeBaseConnector from '@/app/components/datasets/external-knowledge-base/connector'
import { ExternalKnowledgeApiProvider } from '@/context/external-knowledge-api-context'

const ExternalKnowledgeBaseCreation = async () => {
  return (
    <ExternalKnowledgeApiProvider>
      <ExternalKnowledgeBaseConnector />
    </ExternalKnowledgeApiProvider>
  )
}

export default ExternalKnowledgeBaseCreation
