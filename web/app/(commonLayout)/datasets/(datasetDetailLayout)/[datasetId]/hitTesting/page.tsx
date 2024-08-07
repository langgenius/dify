import React from 'react'
import Main from '@/app/components/datasets/hit-testing'

type Props = {
  params: { datasetId: string }
}

const HitTesting = ({
  params: { datasetId },
}: Props) => {
  return (
    <Main datasetId={datasetId} />
  )
}

export default HitTesting
