import React from 'react'
import MainDetail from '@/app/components/datasets/documents/detail'

export type IDocumentDetailProps = {
  params: { datasetId: string; documentId: string }
}

const DocumentDetail = async ({
  params: { datasetId, documentId },
}: IDocumentDetailProps) => {
  return (
    <MainDetail datasetId={datasetId} documentId={documentId} />
  )
}

export default DocumentDetail
