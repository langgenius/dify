import * as React from 'react'
import DatasetUpdateForm from '@/app/components/datasets/create'
import { DocumentTitleSetter } from '../document-title-setter'

const DatasetCreation = async () => {
  return (
    <>
      <DocumentTitleSetter i18nKey="createDataset" namespace="dataset" />
      <DatasetUpdateForm />
    </>
  )
}

export default DatasetCreation
