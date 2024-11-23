'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToastContext } from '@/app/components/base/toast'
import ExternalKnowledgeBaseCreate from '@/app/components/datasets/external-knowledge-base/create'
import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import { createExternalKnowledgeBase } from '@/service/datasets'

const ExternalKnowledgeBaseConnector = () => {
  const { notify } = useToastContext()
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleConnect = async (formValue: CreateKnowledgeBaseReq) => {
    try {
      setLoading(true)
      const result = await createExternalKnowledgeBase({ body: formValue })
      if (result && result.id) {
        notify({ type: 'success', message: 'External Knowledge Base Connected Successfully' })
        router.back()
      }
      else { throw new Error('Failed to create external knowledge base') }
    }
    catch (error) {
      console.error('Error creating external knowledge base:', error)
      notify({ type: 'error', message: 'Failed to connect External Knowledge Base' })
    }
    setLoading(false)
  }
  return (
    <ExternalKnowledgeBaseCreate onConnect={handleConnect} loading={loading} />
  )
}

export default ExternalKnowledgeBaseConnector
