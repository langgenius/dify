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
    <div className="flex h-full min-h-0 flex-col">
      <ApikeyInfoPanel />
      <div className="min-h-0 flex-1">
        <ChartView
          appId={appId}
          headerRight={<TracingPanel />}
        />
      </div>
    </div>
  )
}

export default Overview
