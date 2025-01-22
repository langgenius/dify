import React from 'react'
import ChartView from './chartView'
import CardView from './cardView'
import TracingPanel from './tracing/panel'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'

export type IDevelopProps = {
  params: Promise<{ appId: string }>
}

const Overview = async ({
  params,
}: IDevelopProps) => {
  const appId = (await params).appId
  return (
    <div className="h-full px-4 sm:px-16 py-6 overflow-scroll">
      <ApikeyInfoPanel />
      <TracingPanel />
      <CardView appId={appId} />
      <ChartView appId={appId} />
    </div>
  )
}

export default Overview
