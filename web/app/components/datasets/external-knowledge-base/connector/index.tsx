'use client'

import React from 'react'
import ExternalKnowledgeBaseCreate from '@/app/components/datasets/external-knowledge-base/create'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import { createExternalKnowledgeBase } from '@/service/datasets'

const ExternalKnowledgeBaseConnector = () => {
  const handleConnect = async (formValue: CreateKnowledgeBaseReq) => {
    try {
      const result = await createExternalKnowledgeBase({ body: formValue })
    }
    catch (error) {
      console.error('Error creating external knowledge base:', error)
    }
  }
  return <ExternalKnowledgeBaseCreate onConnect={handleConnect} />
}

export default ExternalKnowledgeBaseConnector
