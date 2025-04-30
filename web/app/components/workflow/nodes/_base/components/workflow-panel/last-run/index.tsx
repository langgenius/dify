'use client'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React from 'react'
import NoData from './no-data'
import { useLastRun } from '@/service/use-workflow'
import Loading from '@/app/components/base/loading'

type Props = {
  appId: string
  nodeId: string
  runningStatus?: NodeRunningStatus
  onSingleRunClicked: () => void
}

const LastRun: FC<Props> = ({
  appId,
  nodeId,
  runningStatus,
  onSingleRunClicked,
}) => {
  const isRunning = runningStatus === NodeRunningStatus.Running
  const { data: runResult, isFetching } = useLastRun(appId, nodeId, !isRunning)

  if (isFetching)
    return <Loading />

  if (isRunning)
    return <ResultPanel status='running' showSteps={false} />

  if (!runResult) {
    return (
      <NoData onSingleRun={onSingleRunClicked} />
    )
  }
  return (
    <div>
      <ResultPanel
        {...runResult as any}
        showSteps={false}
      />
    </div>
  )
}
export default React.memo(LastRun)
