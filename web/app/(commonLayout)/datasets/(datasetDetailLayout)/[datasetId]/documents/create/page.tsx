import React from 'react'
import DatasetUpdateForm from '@/app/components/datasets/create'

export type IProps = {
  params: Promise<{ datasetId: string }>
}

const Create = async ({
  params,
}: IProps) => {
  const datasetId = (await params).datasetId
  return (
    <DatasetUpdateForm datasetId={datasetId} />
  )
}

export default Create
