import React from 'react'
import Settings from '@/app/components/datasets/documents/detail/settings'

export type IProps = {
  params: Promise<{ datasetId: string; documentId: string }>
}

const DocumentSettings = async ({
  params,
}: IProps) => {
  const { datasetId, documentId } = (await params)
  return (
    <Settings datasetId={datasetId} documentId={documentId} />
  )
}

export default DocumentSettings
