import * as React from 'react'
import Main from '@/app/components/datasets/documents'

export type IProps = {
  params: Promise<{ datasetId: string }>
}

const Documents = async (props: IProps) => {
  const params = await props.params

  const {
    datasetId,
  } = params

  return (
    <Main datasetId={datasetId} />
  )
}

export default Documents
