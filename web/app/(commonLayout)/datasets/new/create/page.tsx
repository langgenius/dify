'use client'

import { useTranslation } from 'react-i18next'
import { CreateKnowledgePage } from '@/features/new-rag/create-knowledge-page'
import useDocumentTitle from '@/hooks/use-document-title'

export default function Page() {
  const { t } = useTranslation('dataset')
  useDocumentTitle(t(($) => $['newKnowledge.createTitle']))

  return <CreateKnowledgePage />
}
