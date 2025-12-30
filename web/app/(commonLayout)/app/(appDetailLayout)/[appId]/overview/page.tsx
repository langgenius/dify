import * as React from 'react'
import ApikeyInfoPanel from '@/app/components/app/overview/apikey-info-panel'
import ChartView from './chart-view'
import TracingPanel from './tracing/panel'

export type IDevelopProps = {
  params: Promise<{ appId: string }>
}

const Overview = async (props: IDevelopProps) => {
  const params = await props.params

  const {
    appId,
  } = params

  return (
    <div className="h-full overflow-y-auto bg-chatbot-bg px-4 py-6 sm:px-12">
      <ApikeyInfoPanel />
      <ChartView
        appId={appId}
        headerRight={<TracingPanel />}
      />
    </div>
  )
}

export default Overview
