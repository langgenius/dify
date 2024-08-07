import React from 'react'
import DatasetUpdateForm from '@/app/components/datasets/create'

export type IProps = {
  params: { datasetId: string }
}

const Create = async ({
  params: { datasetId },
}: IProps) => {
  return (
    <DatasetUpdateForm datasetId={datasetId} />
  )
}

export default Create
