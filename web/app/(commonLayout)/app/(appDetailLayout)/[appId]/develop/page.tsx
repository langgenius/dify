import React from 'react'
import DevelopMain from '@/app/components/develop'

export type IDevelopProps = {
  params: Promise<{ appId: string }>
}

const Develop = async ({
  params,
}: IDevelopProps) => {
  return <DevelopMain appId={(await params).appId} />
}

export default Develop
