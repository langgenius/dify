'use client'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import NoData from './no-data'
import { useLastRun } from '@/service/use-workflow'
import Loading from '@/app/components/base/loading'

type Props = {
  isDataFromHistory: boolean
  appId: string
  nodeId: string
  runningStatus?: NodeRunningStatus
}

const LastRun: FC<Props> = ({
  isDataFromHistory,
  appId,
  nodeId,
  runningStatus,
}) => {
  const workflowStore = useWorkflowStore()

  const {
    getLastRunNodeInfo,
  } = workflowStore.getState()
  const { data: runResultFromHistory, isFetching } = useLastRun(appId, nodeId, isDataFromHistory)
  const [runResultFromSingleRun, setRunResult] = useState(isDataFromHistory ? getLastRunNodeInfo(nodeId) : null)
  const runResult = isDataFromHistory ? runResultFromHistory : runResultFromSingleRun
  const isRunning = runningStatus === NodeRunningStatus.Running

  // get data from current running result
  useEffect(() => {
    if (isDataFromHistory)
      return

    setRunResult(getLastRunNodeInfo(nodeId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningStatus, isDataFromHistory])

  const handleSingleRun = () => {
    console.log('run')
  }

  if (isDataFromHistory && isFetching)
    return <Loading />

  if (isRunning)
    return <ResultPanel status='running' showSteps={false} />

  if (!runResultFromSingleRun) {
    return (
      <NoData onSingleRun={handleSingleRun} />
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
