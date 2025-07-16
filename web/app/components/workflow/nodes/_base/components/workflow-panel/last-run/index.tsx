'use client'
import type { ResultPanelProps } from '@/app/components/workflow/run/result-panel'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import NoData from './no-data'
import { useLastRun } from '@/service/use-workflow'
import { RiLoader2Line } from '@remixicon/react'
import type { NodeTracing } from '@/types/workflow'

type Props = {
  appId: string
  nodeId: string
  canSingleRun: boolean
  isRunAfterSingleRun: boolean
  updateNodeRunningStatus: (status: NodeRunningStatus) => void
  nodeInfo?: NodeTracing
  runningStatus?: NodeRunningStatus
  onSingleRunClicked: () => void
  singleRunResult?: NodeTracing
  isPaused?: boolean
} & Partial<ResultPanelProps>

const LastRun: FC<Props> = ({
  appId,
  nodeId,
  canSingleRun,
  isRunAfterSingleRun,
  updateNodeRunningStatus,
  nodeInfo,
  runningStatus: oneStepRunRunningStatus,
  onSingleRunClicked,
  singleRunResult,
  isPaused,
  ...otherResultPanelProps
}) => {
  const isOneStepRunSucceed = oneStepRunRunningStatus === NodeRunningStatus.Succeeded
  const isOneStepRunFailed = oneStepRunRunningStatus === NodeRunningStatus.Failed
  // hide page and return to page would lost the oneStepRunRunningStatus
  const [hidePageOneStepFinishedStatus, setHidePageOneStepFinishedStatus] = React.useState<NodeRunningStatus | null>(null)
  const [pageHasHide, setPageHasHide] = useState(false)
  const [pageShowed, setPageShowed] = useState(false)

  const hidePageOneStepRunFinished = [NodeRunningStatus.Succeeded, NodeRunningStatus.Failed].includes(hidePageOneStepFinishedStatus!)
  const canRunLastRun = !isRunAfterSingleRun || isOneStepRunSucceed || isOneStepRunFailed || (pageHasHide && hidePageOneStepRunFinished)
  const { data: lastRunResult, isFetching, error } = useLastRun(appId, nodeId, canRunLastRun)
  const isRunning = useMemo(() => {
    if(isPaused)
      return false

    if(!isRunAfterSingleRun)
      return isFetching
    return [NodeRunningStatus.Running, NodeRunningStatus.NotStart].includes(oneStepRunRunningStatus!)
  }, [isFetching, isPaused, isRunAfterSingleRun, oneStepRunRunningStatus])

  const noLastRun = (error as any)?.status === 404
  const runResult = (canRunLastRun ? lastRunResult : singleRunResult) || lastRunResult || {}

  const resetHidePageStatus = useCallback(() => {
    setPageHasHide(false)
    setPageShowed(false)
    setHidePageOneStepFinishedStatus(null)
  }, [])
  useEffect(() => {
    if (pageShowed && hidePageOneStepFinishedStatus && (!oneStepRunRunningStatus || oneStepRunRunningStatus === NodeRunningStatus.NotStart)) {
      updateNodeRunningStatus(hidePageOneStepFinishedStatus)
      resetHidePageStatus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOneStepRunSucceed, isOneStepRunFailed, oneStepRunRunningStatus])

  useEffect(() => {
    if([NodeRunningStatus.Succeeded, NodeRunningStatus.Failed].includes(oneStepRunRunningStatus!))
      setHidePageOneStepFinishedStatus(oneStepRunRunningStatus!)
  }, [oneStepRunRunningStatus])

  useEffect(() => {
    resetHidePageStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const handlePageVisibilityChange = useCallback(() => {
      if (document.visibilityState === 'hidden')
        setPageHasHide(true)
      else
        setPageShowed(true)
    }, [])
  useEffect(() => {
    document.addEventListener('visibilitychange', handlePageVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handlePageVisibilityChange)
    }
  }, [handlePageVisibilityChange])

  if (isFetching && !isRunAfterSingleRun) {
    return (
      <div className='flex h-0 grow flex-col items-center justify-center'>
        <RiLoader2Line className='size-4 animate-spin text-text-tertiary' />
      </div>)
  }

  if (isRunning)
    return <ResultPanel status='running' showSteps={false} />

  if (!isPaused && (noLastRun || !runResult)) {
    return (
      <NoData canSingleRun={canSingleRun} onSingleRun={onSingleRunClicked} />
    )
  }
  return (
    <div>
      <ResultPanel
        {...runResult as any}
        {...otherResultPanelProps}
        status={isPaused ? NodeRunningStatus.Stopped : ((runResult as any).status || otherResultPanelProps.status)}
        total_tokens={(runResult as any)?.execution_metadata?.total_tokens || otherResultPanelProps?.total_tokens}
        created_by={(runResult as any)?.created_by_account?.created_by || otherResultPanelProps?.created_by}
        nodeInfo={nodeInfo}
        showSteps={false}
      />
    </div>
  )
}
export default React.memo(LastRun)
