'use client'

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import DatasetUpdateForm from '@/app/components/datasets/create'
import useDocumentTitle from '@/hooks/use-document-title'

const DatasetCreation = () => {
  const { t } = useTranslation()
  useDocumentTitle(
    t(($) => $['stepByStepTour.guides.knowledge.empty.create.title'], { ns: 'common' }),
  )

  return <DatasetUpdateForm />
}

export default DatasetCreation
