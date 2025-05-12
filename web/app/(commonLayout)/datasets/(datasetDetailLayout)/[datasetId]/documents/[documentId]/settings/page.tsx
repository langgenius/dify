import React from 'react'
import Settings from '@/app/components/datasets/documents/detail/settings'

export type IProps = {
  params: Promise<{ datasetId: string; documentId: string }>
}

const DocumentSettings = async (props: IProps) => {
  const params = await props.params

  const {
    datasetId,
    documentId,
  } = params

  return (
    <Settings datasetId={datasetId} documentId={documentId} />
  )
}

export default DocumentSettings
