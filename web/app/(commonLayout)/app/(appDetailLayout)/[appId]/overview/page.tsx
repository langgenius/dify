import React from 'react'
import ChartView from './chartView'
import CardView from './cardView'
import TracingPanel from './tracing/panel'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'
import Test from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/test'

export type IDevelopProps = {
  params: { appId: string }
}

const Overview = async ({
  params: { appId },
}: IDevelopProps) => {
  return (
    <div className="h-full px-4 sm:px-12 py-6 overflow-scroll bg-chatbot-bg">
      <Test />
      <ApikeyInfoPanel />
      <TracingPanel />
      <CardView appId={appId} />
      <ChartView appId={appId} />
    </div>
  )
}

export default Overview
