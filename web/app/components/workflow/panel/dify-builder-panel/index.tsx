import type { ChecklistErrorPayload } from '@/app/components/dify-builder/types'
import type { ChecklistItem } from '@/app/components/workflow/hooks/use-checklist'
import type { CommonEdgeType } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges } from 'reactflow'
import { CHECKLIST_AWAIT_RECHECK_STATE } from '@/app/components/dify-builder/types'
import { useDifyBuilderSession } from '@/app/components/dify-builder/use-dify-builder-session'
import { useHooksStore } from '@/app/components/workflow/hooks-store/store'
import { useChecklist } from '@/app/components/workflow/hooks/use-checklist'
import { useIsChatMode } from '@/app/components/workflow/hooks/use-workflow'
import { useWorkflowRefreshDraft } from '@/app/components/workflow/hooks/use-workflow-refresh-draft'
import { useStore } from '@/app/components/workflow/store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { API_PREFIX } from '@/config'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { useWorkflowRunHistory } from '@/service/use-workflow'
import ChecklistToFix from './checklist-to-fix'
import DifyBuilderSessionView from './dify-builder-session-view'
import RunToFix from './run-to-fix'

// Maps a client-side `ChecklistItem` onto the backend's `ChecklistError` JSON
// shape, used both to seed a checklist-fix session and to report the
// still-failing items on a `recheck` action.
const toChecklistErrorPayload = (item: ChecklistItem): ChecklistErrorPayload => ({
  node_id: item.id,
  node_type: String(item.type),
  title: item.title,
  messages: item.errorMessages,
  unconnected: !!item.unConnected,
  plugin_missing: !!item.isPluginMissing,
})

function DifyBuilderPanel() {
  const { t } = useTranslation()
  const appId = useStore((s) => s.appId)
  const setShowDifyBuilderPanel = useStore((s) => s.setShowDifyBuilderPanel)
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
  const [isStartingChecklistFix, setIsStartingChecklistFix] = useState(false)
  const [messageText, setMessageText] = useState('')

  // The pre-publish checklist is computed client-side from the current draft
  // canvas, exactly like the header checklist popover and the pre-run
  // validation gate — it stays reactive to canvas edits made both by the
  // user and (once landed) by the difyBuilder's own applied repairs.
  const nodes = useNodes()
  const edges = useEdges<CommonEdgeType>()
  const flowType = useHooksStore((s) => s.configsMap?.flowType)
  const checklistItems = useChecklist(nodes, edges, { flowType })
  // Config errors (`errorMessages`) are addressable via the backend's
  // `set_node_config` repair; unconnected nodes and missing plugins are
  // structural and not auto-fixable in v1 (see `bizdifyBuilder.ChecklistError`
  // doc comment), so they're surfaced but excluded from the fixable count
  // even when they also carry a message (e.g. "plugin not installed").
  const { fixableChecklistItems, unfixableChecklistItems } = useMemo(() => {
    const fixable: ChecklistItem[] = []
    const unfixable: ChecklistItem[] = []
    checklistItems.forEach((item) => {
      if (item.unConnected || item.isPluginMissing) unfixable.push(item)
      else if (item.errorMessages.length > 0) fixable.push(item)
    })
    return { fixableChecklistItems: fixable, unfixableChecklistItems: unfixable }
  }, [checklistItems])

  const { view, lastError, progressLog, startFix, startChecklistFix, runAction, sendMessage } =
    useDifyBuilderSession({
      baseUrl: API_PREFIX,
    })

  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const isSyncingWorkflowDraft = useStore((s) => s.isSyncingWorkflowDraft)

  // The difyBuilder applies checklist repairs to the *server* draft (via the
  // backend adapter), not the local canvas, so `nodes`/`useChecklist` above
  // stay on the stale pre-fix graph until something pulls the draft back in.
  // When the session hands control back for a re-check
  // (`checklist.await_recheck`), refresh the draft into the canvas once per
  // entry into that state, so the re-check reflects the difyBuilder's applied
  // fix. This can't clobber unsaved user edits: the canvas is read-only for
  // the duration of the session, and the editor's own autosave only pushes
  // local changes to the draft, never pulls.
  useEffect(() => {
    if (view?.state === CHECKLIST_AWAIT_RECHECK_STATE) handleRefreshWorkflowDraft()
  }, [view?.state, handleRefreshWorkflowDraft])

  const resolvedRunId = manualRunId.trim() || latestFailedRun?.id || ''
  const canStartFix = !!appId && !!currentWorkspace.id && !!resolvedRunId
  const canStartChecklistFix = !!appId && !!currentWorkspace.id && fixableChecklistItems.length > 0

  const handleStartFix = useCallback(() => {
    if (!canStartFix) return
    setIsStarting(true)
    void startFix(appId, resolvedRunId).finally(() => setIsStarting(false))
  }, [appId, canStartFix, resolvedRunId, startFix])

  const handleStartChecklistFix = useCallback(() => {
    if (!canStartChecklistFix || !appId) return
    setIsStartingChecklistFix(true)
    void startChecklistFix(appId, checklistItems.map(toChecklistErrorPayload)).finally(() =>
      setIsStartingChecklistFix(false),
    )
  }, [appId, canStartChecklistFix, checklistItems, startChecklistFix])

  const handleRunAction = useCallback(
    (kind: Parameters<typeof runAction>[0]) => {
      void runAction(kind, kind === 'provide_testdata' ? { mode: 'mock' } : {})
    },
    [runAction],
  )

  // Drives `checklist.await_recheck`: report the *current* client-side
  // checklist back to the session. `passed` only reflects fixable (config)
  // items — unfixable structural ones can't be resolved by this loop, so
  // they mustn't block it from handing off to the publish/keep/re-fix
  // decision gate. All still-outstanding items (fixable and unfixable) are
  // still sent in `remaining` so the session's record stays accurate.
  const handleRecheck = useCallback(() => {
    void runAction('recheck', {
      passed: fixableChecklistItems.length === 0,
      remaining: checklistItems.map(toChecklistErrorPayload),
    })
  }, [checklistItems, fixableChecklistItems, runAction])

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
        {t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            className="flex size-6 cursor-pointer items-center justify-center"
            onClick={() => setShowDifyBuilderPanel(false)}
          >
            <span aria-hidden className="i-ri-close-line size-4 text-text-tertiary" />
          </button>
        </div>
      </div>
      <div className="shrink-0 px-4 py-1 system-sm-regular text-text-tertiary">
        {t(($) => $['difyBuilder.panelDescription'], { ns: 'workflow' })}
      </div>

      <div className="shrink-0 px-4 py-2 system-xs-regular text-text-tertiary">
        <div>
          {t(($) => $['difyBuilder.appLabel'], { ns: 'workflow' })}: {appId || '—'}
        </div>
        <div>
          {t(($) => $['difyBuilder.workspaceLabel'], { ns: 'workflow' })}:{' '}
          {currentWorkspace.name || currentWorkspace.id || '—'}
        </div>
      </div>

      <div className="grow overflow-y-auto rounded-b-2xl">
        {!view && (
          <>
            <RunToFix
              isRunHistoryLoading={isRunHistoryLoading}
              latestFailedRun={latestFailedRun}
              manualRunId={manualRunId}
              onManualRunIdChange={setManualRunId}
              canStartFix={canStartFix}
              isStarting={isStarting}
              onStartFix={handleStartFix}
            />
            {checklistItems.length > 0 && (
              <>
                <div className="mx-4 border-t border-components-panel-border" />
                <ChecklistToFix
                  fixableItems={fixableChecklistItems}
                  unfixableItems={unfixableChecklistItems}
                  canStartChecklistFix={canStartChecklistFix}
                  isStarting={isStartingChecklistFix}
                  onStartChecklistFix={handleStartChecklistFix}
                />
              </>
            )}
          </>
        )}
        {view && (
          <DifyBuilderSessionView
            view={view}
            progressLog={progressLog}
            onRunAction={handleRunAction}
            messageText={messageText}
            onMessageTextChange={setMessageText}
            onSendMessage={handleSendMessage}
            fixableChecklistItems={fixableChecklistItems}
            unfixableChecklistItems={unfixableChecklistItems}
            onRecheck={handleRecheck}
            isRefreshingDraftForRecheck={isSyncingWorkflowDraft}
          />
        )}
        {lastError && (
          <div className="px-4 pb-3 system-xs-regular text-text-destructive">
            {t(($) => $['difyBuilder.errorPrefix'], { ns: 'workflow' })}: {lastError}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(DifyBuilderPanel)
