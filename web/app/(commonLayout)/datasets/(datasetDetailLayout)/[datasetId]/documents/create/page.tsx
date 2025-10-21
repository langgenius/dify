import React from 'react'
import DatasetUpdateForm from '@/app/components/datasets/create'

export type IProps = {
  params: Promise<{ datasetId: string }>
}

const Create = async (props: IProps) => {
  const params = await props.params

  const {
    datasetId,
  } = params

  return (
    <DatasetUpdateForm datasetId={datasetId} />
  )
}

export default Create
