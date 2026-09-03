'use client'
import type { FC } from 'react'
import type { ResultPanelProps } from '@/app/components/workflow/run/result-panel'
import type { NodeTracing } from '@/types/workflow'
import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { useLastRun } from '@/service/use-workflow'
import { FlowType } from '@/types/common'
import NoData from './no-data'

type Props = Readonly<{
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
}> &
  Partial<ResultPanelProps>

const LastRun: FC<Props> = ({
  appId: _appId,
  nodeId,
  canSingleRun,
  isRunAfterSingleRun,
  updateNodeRunningStatus,
  nodeInfo: _nodeInfo,
  runningStatus: oneStepRunRunningStatus,
  onSingleRunClicked,
  singleRunResult,
  isPaused,
  ...otherResultPanelProps
}) => {
  const configsMap = useHooksStore((s) => s.configsMap)
  const isOneStepRunSucceed = oneStepRunRunningStatus === NodeRunningStatus.Succeeded
  const isOneStepRunFailed = oneStepRunRunningStatus === NodeRunningStatus.Failed
  // hide page and return to page would lost the oneStepRunRunningStatus
  const [hidePageOneStepFinishedStatus, setHidePageOneStepFinishedStatus] =
    React.useState<NodeRunningStatus | null>(null)
  const [pageHasHide, setPageHasHide] = useState(false)
  const [pageShowed, setPageShowed] = useState(false)

  const hidePageOneStepRunFinished = [
    NodeRunningStatus.Succeeded,
    NodeRunningStatus.Failed,
  ].includes(hidePageOneStepFinishedStatus!)
  const canRunLastRun =
    !isRunAfterSingleRun ||
    isOneStepRunSucceed ||
    isOneStepRunFailed ||
    (pageHasHide && hidePageOneStepRunFinished)
  const {
    data: lastRunResult,
    isFetching,
    error,
  } = useLastRun(
    configsMap?.flowType || FlowType.appFlow,
    configsMap?.flowId || '',
    nodeId,
    canRunLastRun,
  )
  const hasAuthoritativeLastRun = canRunLastRun && !!lastRunResult
  const isRunning =
    !isPaused &&
    (isRunAfterSingleRun
      ? !hasAuthoritativeLastRun &&
        [NodeRunningStatus.Running, NodeRunningStatus.NotStart].includes(oneStepRunRunningStatus!)
      : isFetching)

  const noLastRun = (error as any)?.status === 404
  const runResult = (canRunLastRun ? lastRunResult : singleRunResult) || lastRunResult || {}

  let resolvedStatus = (runResult as any).status || otherResultPanelProps.status
  if (isPaused || oneStepRunRunningStatus === NodeRunningStatus.Stopped)
    resolvedStatus = NodeRunningStatus.Stopped
  else if (oneStepRunRunningStatus === NodeRunningStatus.Listening)
    resolvedStatus = NodeRunningStatus.Listening

  const resetHidePageStatus = useCallback(() => {
    setPageHasHide(false)
    setPageShowed(false)
    setHidePageOneStepFinishedStatus(null)
  }, [])
  useEffect(() => {
    if (!pageShowed || !hidePageOneStepFinishedStatus) return

    if (!oneStepRunRunningStatus || oneStepRunRunningStatus === NodeRunningStatus.NotStart) {
      updateNodeRunningStatus(hidePageOneStepFinishedStatus)
      return
    }

    resetHidePageStatus()
  }, [
    hidePageOneStepFinishedStatus,
    oneStepRunRunningStatus,
    pageShowed,
    resetHidePageStatus,
    updateNodeRunningStatus,
  ])

  useEffect(() => {
    if ([NodeRunningStatus.Succeeded, NodeRunningStatus.Failed].includes(oneStepRunRunningStatus!))
      setHidePageOneStepFinishedStatus(oneStepRunRunningStatus!)
  }, [oneStepRunRunningStatus])

  useEffect(() => {
    resetHidePageStatus()
  }, [nodeId, resetHidePageStatus])

  const handlePageVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'hidden') setPageHasHide(true)
    else setPageShowed(true)
  }, [])
  useEffect(() => {
    document.addEventListener('visibilitychange', handlePageVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handlePageVisibilityChange)
    }
  }, [handlePageVisibilityChange])

  if (isFetching && !isRunAfterSingleRun) {
    return (
      <div className="flex h-0 grow flex-col items-center justify-center">
        <RiLoader2Line className="size-4 animate-spin text-text-tertiary" />
      </div>
    )
  }

  if (isRunning) return <ResultPanel status="running" showSteps={false} />
  if (!isPaused && (noLastRun || !runResult)) {
    return <NoData canSingleRun={canSingleRun} onSingleRun={onSingleRunClicked} />
  }

  return (
    <div>
      <ResultPanel
        {...(runResult as any)}
        {...otherResultPanelProps}
        status={resolvedStatus}
        total_tokens={
          (runResult as any)?.execution_metadata?.total_tokens ||
          otherResultPanelProps?.total_tokens
        }
        created_by={
          (runResult as any)?.created_by_account?.created_by || otherResultPanelProps?.created_by
        }
        nodeInfo={runResult as NodeTracing}
        showSteps={false}
      />
    </div>
  )
}
export default React.memo(LastRun)
