import React from 'react'
import MainDetail from '@/app/components/datasets/documents/detail'

export type IDocumentDetailProps = {
  params: Promise<{ datasetId: string; documentId: string }>
}

const DocumentDetail = async (props: IDocumentDetailProps) => {
  const params = await props.params

  const {
    datasetId,
    documentId,
  } = params

  return (
    <MainDetail datasetId={datasetId} documentId={documentId} />
  )
}

export default DocumentDetail
