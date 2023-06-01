import React from 'react'
import Settings from '@/app/components/datasets/documents/detail/settings'

export type IProps = {
  params: { datasetId: string; documentId: string }
}

const DocumentSettings = async ({
  params: { datasetId, documentId },
}: IProps) => {
  return (
    <Settings datasetId={datasetId} documentId={documentId} />
  )
}

export default DocumentSettings
