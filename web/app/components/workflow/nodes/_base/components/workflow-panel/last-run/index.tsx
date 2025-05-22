'use client'
import type { ResultPanelProps } from '@/app/components/workflow/run/result-panel'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React from 'react'
import NoData from './no-data'
import { useLastRun } from '@/service/use-workflow'
import { RiLoader2Line } from '@remixicon/react'
import type { NodeTracing } from '@/types/workflow'

type Props = {
  appId: string
  nodeId: string
  canSingleRun: boolean
  nodeInfo?: NodeTracing
  runningStatus?: NodeRunningStatus
  onSingleRunClicked: () => void
  singleRunResult?: NodeTracing
} & Partial<ResultPanelProps>

const LastRun: FC<Props> = ({
  appId,
  nodeId,
  canSingleRun,
  nodeInfo,
  runningStatus: oneStepRunRunningStatus,
  onSingleRunClicked,
  singleRunResult,
  ...otherResultPanelProps
}) => {
  const isRunning = oneStepRunRunningStatus === NodeRunningStatus.Running
  // const isOneStepRunSuccess = oneStepRunRunningStatus === NodeRunningStatus.Succeeded
  const isOneStepRunFailed = oneStepRunRunningStatus === NodeRunningStatus.Failed
  const { data: lastRunResult, isFetching } = useLastRun(appId, nodeId, !isOneStepRunFailed)
  const runResult = (isOneStepRunFailed ? singleRunResult : lastRunResult) || {}

  if (isFetching) {
    return (
      <div className='flex h-0 grow flex-col items-center justify-center'>
        <RiLoader2Line className='size-4 animate-spin text-text-tertiary' />
      </div>)
  }

  if (isRunning)
    return <ResultPanel status='running' showSteps={false} />

  if (!runResult) {
    return (
      <NoData canSingleRun={canSingleRun} onSingleRun={onSingleRunClicked} />
    )
  }
  return (
    <div>
      <ResultPanel
        {...runResult as any}
        {...otherResultPanelProps}
        nodeInfo={nodeInfo}
        showSteps={false}
      />
    </div>
  )
}
export default React.memo(LastRun)
