import * as React from 'react'
import CreateFromPipeline from '@/app/components/datasets/create-from-pipeline'
import { DocumentTitleSetter } from '../document-title-setter'

const DatasetCreation = async () => {
  return (
    <>
      <DocumentTitleSetter i18nKey="creation.pageTitle" namespace="datasetPipeline" />
      <CreateFromPipeline />
    </>
  )
}

export default DatasetCreation
