import React from 'react'
import Settings from '@/app/components/datasets/documents/detail/settings'

export type IProps = {
  params: Promise<{ datasetId: string; documentId: string }>
}

const DocumentSettings = async ({
  params,
}: IProps) => {
  return (
    <Settings datasetId={(await params).datasetId} documentId={(await params).documentId} />
  )
}

export default DocumentSettings
