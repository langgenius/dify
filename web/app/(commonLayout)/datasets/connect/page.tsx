'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ExternalKnowledgeBaseConnector from '@/app/components/datasets/external-knowledge-base/connector'
import useDocumentTitle from '@/hooks/use-document-title'

const ExternalKnowledgeBaseCreation = () => {
  const { t } = useTranslation()
  useDocumentTitle(
    t(($) => $['stepByStepTour.guides.knowledge.empty.connect.title'], { ns: 'common' }),
  )

  return <ExternalKnowledgeBaseConnector />
}

export default ExternalKnowledgeBaseCreation
