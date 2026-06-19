import * as React from 'react'
import OverviewView from './view'

export type IDevelopProps = {
  params: Promise<{ appId: string }>
}

const Overview = async (props: IDevelopProps) => {
  const params = await props.params

  const {
    appId,
  } = params

  return (
    <OverviewView appId={appId} />
  )
}

export default Overview
