import React from 'react'
import Main from '@/app/components/datasets/hit-testing'

type Props = {
  params: Promise<{ datasetId: string }>
}

const HitTesting = async ({
  params,
}: Props) => {
  return (
    <Main datasetId={(await params).datasetId} />
  )
}

export default HitTesting
