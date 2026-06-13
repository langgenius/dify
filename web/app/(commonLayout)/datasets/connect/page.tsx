import * as React from 'react'
import ExternalKnowledgeBaseConnector from '@/app/components/datasets/external-knowledge-base/connector'
import { DocumentTitleSetter } from '../document-title-setter'

const ExternalKnowledgeBaseCreation = () => {
  return (
    <>
      <DocumentTitleSetter i18nKey="pageTitle.connectExternalKnowledgeBase" namespace="dataset" />
      <ExternalKnowledgeBaseConnector />
    </>
  )
}

export default ExternalKnowledgeBaseCreation
