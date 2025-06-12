'use client'
import React from 'react'
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
  const pipelineId = useDatasetDetailContextWithSelector(s => s.dataset?.pipeline_id)

  if (!pipelineId) {
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
