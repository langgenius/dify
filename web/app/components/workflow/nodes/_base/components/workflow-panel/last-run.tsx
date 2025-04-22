'use client'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'

type Props = {
  nodeId: string
  runningStatus: NodeRunningStatus
}

const LastRun: FC<Props> = ({
  nodeId,
  runningStatus,
}) => {
  const workflowStore = useWorkflowStore()

  const {
    getLastRunNodeInfo,
  } = workflowStore.getState()
  const [runResult, setRunResult] = useState(getLastRunNodeInfo(nodeId))
  const isRunning = runningStatus === NodeRunningStatus.Running

  useEffect(() => {
    setRunResult(getLastRunNodeInfo(nodeId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningStatus])
  if (isRunning)
    return <ResultPanel status='running' showSteps={false} />

  if (!runResult) {
    return (
      <div>no data</div>
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
