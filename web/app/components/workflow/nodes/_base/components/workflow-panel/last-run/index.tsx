'use client'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React from 'react'
import NoData from './no-data'
import { useLastRun } from '@/service/use-workflow'
import { RiLoader2Line } from '@remixicon/react'

type Props = {
  appId: string
  nodeId: string
  canSingleRun: boolean
  runningStatus?: NodeRunningStatus
  onSingleRunClicked: () => void
}

const LastRun: FC<Props> = ({
  appId,
  nodeId,
  canSingleRun,
  runningStatus,
  onSingleRunClicked,
}) => {
  const isRunning = runningStatus === NodeRunningStatus.Running
  const { data: runResult, isFetching } = useLastRun(appId, nodeId, !isRunning)

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
        showSteps={false}
      />
    </div>
  )
}
export default React.memo(LastRun)
