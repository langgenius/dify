import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsChatMode } from '@/app/components/workflow/hooks/use-workflow'
import { useStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useCopilotSession } from '@/app/components/workflow-copilot/use-copilot-session'
import { API_PREFIX } from '@/config'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { useWorkflowRunHistory } from '@/service/use-workflow'
import CopilotSessionView from './copilot-session-view'
import RunToFix from './run-to-fix'

function WorkflowCopilotPanel() {
  const { t } = useTranslation()
  const appId = useStore((s) => s.appId)
  const setShowWorkflowCopilotPanel = useStore((s) => s.setShowWorkflowCopilotPanel)
  const isChatMode = useIsChatMode()
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)

  const historyUrl = appId
    ? isChatMode
      ? `/apps/${appId}/advanced-chat/workflow-runs`
      : `/apps/${appId}/workflow-runs`
    : undefined
  const { data: runHistoryData, isLoading: isRunHistoryLoading } = useWorkflowRunHistory(
    historyUrl,
    !!historyUrl,
  )
  // TODO: the run history endpoint does not support server-side status filtering yet,
  // so we scan the most recent page for the latest failed run client-side.
  const latestFailedRun = useMemo(
    () => runHistoryData?.data.find((run) => run.status === WorkflowRunningStatus.Failed),
    [runHistoryData],
  )

  const [manualRunId, setManualRunId] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [messageText, setMessageText] = useState('')

  const { view, lastError, progressLog, startFix, runAction, sendMessage } = useCopilotSession({
    baseUrl: API_PREFIX,
    workspaceId: currentWorkspace.id,
  })

  const resolvedRunId = manualRunId.trim() || latestFailedRun?.id || ''
  const canStartFix = !!appId && !!currentWorkspace.id && !!resolvedRunId

  const handleStartFix = useCallback(() => {
    if (!canStartFix) return
    setIsStarting(true)
    void startFix(appId, resolvedRunId).finally(() => setIsStarting(false))
  }, [appId, canStartFix, resolvedRunId, startFix])

  const handleRunAction = useCallback(
    (kind: Parameters<typeof runAction>[0]) => {
      void runAction(kind, kind === 'provide_testdata' ? { mode: 'mock' } : {})
    },
    [runAction],
  )

  const handleSendMessage = useCallback(() => {
    if (!messageText.trim()) return
    void sendMessage(messageText).then((ok) => {
      if (ok) setMessageText('')
    })
  }, [messageText, sendMessage])

  return (
    <div
      className={cn(
        'relative flex h-full w-[420px] flex-col rounded-r-2xl border border-components-panel-border bg-components-panel-bg-alt',
      )}
    >
      <div className="flex shrink-0 items-center justify-between p-4 pb-0 system-xl-semibold text-text-primary">
        {t(($) => $['copilot.panelTitle'], { ns: 'workflow' })}
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            className="flex size-6 cursor-pointer items-center justify-center"
            onClick={() => setShowWorkflowCopilotPanel(false)}
          >
            <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
          </button>
        </div>
      </div>
      <div className="shrink-0 px-4 py-1 system-sm-regular text-text-tertiary">
        {t(($) => $['copilot.panelDescription'], { ns: 'workflow' })}
      </div>

      <div className="shrink-0 px-4 py-2 system-xs-regular text-text-tertiary">
        <div>
          {t(($) => $['copilot.appLabel'], { ns: 'workflow' })}: {appId || '—'}
        </div>
        <div>
          {t(($) => $['copilot.workspaceLabel'], { ns: 'workflow' })}:{' '}
          {currentWorkspace.name || currentWorkspace.id || '—'}
        </div>
      </div>

      <div className="grow overflow-y-auto rounded-b-2xl">
        {!view && (
          <RunToFix
            isRunHistoryLoading={isRunHistoryLoading}
            latestFailedRun={latestFailedRun}
            manualRunId={manualRunId}
            onManualRunIdChange={setManualRunId}
            canStartFix={canStartFix}
            isStarting={isStarting}
            onStartFix={handleStartFix}
          />
        )}
        {view && (
          <CopilotSessionView
            view={view}
            progressLog={progressLog}
            onRunAction={handleRunAction}
            messageText={messageText}
            onMessageTextChange={setMessageText}
            onSendMessage={handleSendMessage}
          />
        )}
        {lastError && (
          <div className="px-4 pb-3 system-xs-regular text-text-destructive">
            {t(($) => $['copilot.errorPrefix'], { ns: 'workflow' })}: {lastError}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(WorkflowCopilotPanel)
