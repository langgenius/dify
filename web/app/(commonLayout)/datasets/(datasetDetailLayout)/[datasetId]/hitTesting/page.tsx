import React from 'react'
import Main from '@/app/components/datasets/hit-testing'

type Props = {
  params: Promise<{ datasetId: string }>
}

const HitTesting = async ({
  params,
}: Props) => {
  const datasetId = (await params).datasetId
  return (
    <Main datasetId={datasetId} />
  )
}

export default HitTesting
