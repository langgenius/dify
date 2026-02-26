'use client'
import * as React from 'react'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import DocumentSettings from './document-settings'
import PipelineSettings from './pipeline-settings'

type SettingsProps = {
  datasetId: string
  documentId: string
}

const Settings = ({
  datasetId,
  documentId,
}: SettingsProps) => {
  const runtimeMode = useDatasetDetailContextWithSelector(s => s.dataset?.runtime_mode)
  const isGeneralDataset = runtimeMode === 'general'

  if (isGeneralDataset) {
    return (
      <DocumentSettings
        datasetId={datasetId}
        documentId={documentId}
      />
    )
  }

  return (
    <PipelineSettings
      datasetId={datasetId}
      documentId={documentId}
    />
  )
}

export default Settings
