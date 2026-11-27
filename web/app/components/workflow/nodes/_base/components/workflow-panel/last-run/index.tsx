'use client'

import type { FC } from 'react'
import type { ResultPanelProps } from '@/app/components/workflow/run/result-panel'
import type { NodeTracing } from '@/types/workflow'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { RiLoader2Line } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { isBoundAgentV2Execution } from '@/app/components/workflow/nodes/agent-v2/execution'
import ResultPanel from '@/app/components/workflow/run/result-panel'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { lastRunQueryOptions } from '@/service/workflow-queries'
import NoData from './no-data'

type Props = Readonly<{
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
  const finishedStatuses: readonly NodeRunningStatus[] = [
    NodeRunningStatus.Succeeded,
    NodeRunningStatus.Failed,
  ]
  const activeStatuses: readonly NodeRunningStatus[] = [
    NodeRunningStatus.Running,
    NodeRunningStatus.NotStart,
  ]

  const resource = useAtomValue(editorResourceAtom)
  const isOneStepRunSucceed = oneStepRunRunningStatus === NodeRunningStatus.Succeeded
  const isOneStepRunFailed = oneStepRunRunningStatus === NodeRunningStatus.Failed
  // hide page and return to page would lost the oneStepRunRunningStatus
  const [hidePageOneStepFinishedStatus, setHidePageOneStepFinishedStatus] =
    React.useState<NodeRunningStatus | null>(null)
  const [pageHasHide, setPageHasHide] = useState(false)
  const [pageShowed, setPageShowed] = useState(false)

  const hidePageOneStepRunFinished = finishedStatuses.includes(hidePageOneStepFinishedStatus!)
  const canRunLastRun =
    !isRunAfterSingleRun ||
    isOneStepRunSucceed ||
    isOneStepRunFailed ||
    (pageHasHide && hidePageOneStepRunFinished)
  const { t } = useTranslation(['workflow', 'common'])
  const lastRunQuery = useQuery({
    ...lastRunQueryOptions(resource, nodeId),
    enabled: canRunLastRun,
  })
  const { data: lastRunResult, isFetching } = lastRunQuery
  const hasAuthoritativeLastRun = canRunLastRun && !!lastRunResult
  const isRunning =
    !isPaused &&
    (isRunAfterSingleRun
      ? !hasAuthoritativeLastRun && activeStatuses.includes(oneStepRunRunningStatus!)
      : isFetching)
  // The loading and running states show in place of the alert, so they do not render the failure.
  const isLoadingLastRun = isFetching && !isRunAfterSingleRun
  // A single run's own result takes the place of a last run that failed to load.
  const lastRunLoad = useOwnedQueryError(
    {
      data: lastRunResult,
      error: lastRunQuery.error,
      isError: lastRunQuery.isError && canRunLastRun && !singleRunResult,
      isFetching,
      refetch: lastRunQuery.refetch,
    },
    !isLoadingLastRun && !isRunning,
  )
  const lastRunErrorMessage = useRequestErrorMessage(
    lastRunLoad?.error,
    t(($) => $['common.loadFailed'], { ns: 'workflow' }),
  )

  const noLastRun = lastRunResult === null
  const runResult = (canRunLastRun ? lastRunResult : singleRunResult) || lastRunResult || {}
  const lastRunNode = runResult as Partial<NodeTracing>
  const externalTrace =
    resource.kind === 'app' && isBoundAgentV2Execution(lastRunNode) && lastRunNode.id
      ? { appId: resource.appId, kind: 'node' as const, nodeExecutionId: lastRunNode.id }
      : undefined

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
    const finishedStatuses: readonly NodeRunningStatus[] = [
      NodeRunningStatus.Succeeded,
      NodeRunningStatus.Failed,
    ]

    if (finishedStatuses.includes(oneStepRunRunningStatus!))
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

  if (isLoadingLastRun) {
    return (
      <div className="flex h-0 grow flex-col items-center justify-center">
        <RiLoader2Line className="size-4 animate-spin text-text-tertiary" />
      </div>
    )
  }

  if (isRunning) return <ResultPanel status="running" showSteps={false} />
  if (lastRunLoad) {
    return (
      <div className="p-4">
        <Alert type="error">
          <AlertTitle>{lastRunErrorMessage}</AlertTitle>
          <AlertActions>
            <Button
              size="small"
              variant="secondary"
              loading={lastRunLoad.retrying}
              onClick={lastRunLoad.retry}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </AlertActions>
        </Alert>
      </div>
    )
  }
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
        externalTrace={externalTrace}
      />
    </div>
  )
}
export default React.memo(LastRun)
