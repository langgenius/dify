import React from 'react'
import MainDetail from '@/app/components/datasets/documents/detail'

export type IDocumentDetailProps = {
  params: Promise<{ datasetId: string; documentId: string }>
}

const DocumentDetail = async ({
  params,
}: IDocumentDetailProps) => {
  return (
    <MainDetail datasetId={(await params).datasetId} documentId={(await params).documentId} />
  )
}

export default DocumentDetail
