import React from 'react'
import Main from '@/app/components/datasets/documents'

export type IProps = {
  params: Promise<{ datasetId: string }>
}

const Documents = async ({
  params,
}: IProps) => {
  return (
    <Main datasetId={(await params).datasetId} />
  )
}

export default Documents
