import React from 'react'
import Main from '@/app/components/datasets/hit-testing'

type Props = {
  params: Promise<{ datasetId: string }>
}

const HitTesting = async (props: Props) => {
  const params = await props.params

  const {
    datasetId,
  } = params

  return (
    <Main datasetId={datasetId} />
  )
}

export default HitTesting
