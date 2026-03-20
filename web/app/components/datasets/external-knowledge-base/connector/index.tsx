'use client'

import type { CreateKnowledgeBaseReq } from '@/app/components/datasets/external-knowledge-base/create/declarations'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { toast } from '@/app/components/base/ui/toast'
import ExternalKnowledgeBaseCreate from '@/app/components/datasets/external-knowledge-base/create'
import { useRouter } from '@/next/navigation'
import { createExternalKnowledgeBase } from '@/service/datasets'

const ExternalKnowledgeBaseConnector = () => {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { t } = useTranslation()

  const handleConnect = async (formValue: CreateKnowledgeBaseReq) => {
    try {
      setLoading(true)
      const result = await createExternalKnowledgeBase({ body: formValue })
      if (result && result.id) {
        toast.success(t('externalKnowledgeForm.connectedSuccess', { ns: 'dataset' }))
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
      toast.error(t('externalKnowledgeForm.connectedFailed', { ns: 'dataset' }))
    }
    setLoading(false)
  }
  return (
    <ExternalKnowledgeBaseCreate onConnect={handleConnect} loading={loading} />
  )
}

export default ExternalKnowledgeBaseConnector
