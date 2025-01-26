import React from 'react'
import MainDetail from '@/app/components/datasets/documents/detail'

export type IDocumentDetailProps = {
  params: Promise<{ datasetId: string; documentId: string }>
}

const DocumentDetail = async ({
  params,
}: IDocumentDetailProps) => {
  const { datasetId, documentId } = (await params)
  return (
    <MainDetail datasetId={datasetId} documentId={documentId} />
  )
}

export default DocumentDetail
