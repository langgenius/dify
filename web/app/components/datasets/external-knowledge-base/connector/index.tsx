'use client'

import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useState } from 'react'
import { trackEvent } from '@/app/components/base/amplitude'
import { useToastContext } from '@/app/components/base/toast'
import ExternalKnowledgeBaseCreate from '@/app/components/datasets/external-knowledge-base/create'
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
        trackEvent('create_external_knowledge_base', {
          provider: formValue.provider,
          name: formValue.name,
        })
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
