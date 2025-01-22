import React from 'react'
import DatasetUpdateForm from '@/app/components/datasets/create'

export type IProps = {
  params: Promise<{ datasetId: string }>
}

const Create = async ({
  params,
}: IProps) => {
  return (
    <DatasetUpdateForm datasetId={(await params).datasetId} />
  )
}

export default Create
