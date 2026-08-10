'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import CreateFromPipeline from '@/app/components/datasets/create-from-pipeline'
import useDocumentTitle from '@/hooks/use-document-title'

const DatasetCreation = () => {
  const { t } = useTranslation()
  useDocumentTitle(
    t(($) => $['stepByStepTour.guides.knowledge.empty.pipeline.title'], { ns: 'common' }),
  )

  return <CreateFromPipeline />
}

export default DatasetCreation
