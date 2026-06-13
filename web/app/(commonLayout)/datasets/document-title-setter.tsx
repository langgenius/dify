'use client'

import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'

type DatasetDocumentTitleSetterProps = {
  i18nKey: 'createDataset' | 'pageTitle.connectExternalKnowledgeBase'
  namespace: 'dataset'
}

type DatasetPipelineDocumentTitleSetterProps = {
  i18nKey: 'creation.pageTitle'
  namespace: 'datasetPipeline'
}

type DocumentTitleSetterProps = DatasetDocumentTitleSetterProps | DatasetPipelineDocumentTitleSetterProps

export function DocumentTitleSetter({
  i18nKey,
  namespace,
}: DocumentTitleSetterProps) {
  const { t } = useTranslation()
  const title = namespace === 'dataset'
    ? t(i18nKey, { ns: 'dataset' })
    : t(i18nKey, { ns: 'datasetPipeline' })

  useDocumentTitle(title)

  return null
}
