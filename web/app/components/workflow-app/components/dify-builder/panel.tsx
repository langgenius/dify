import type { DifyBuilderChecklistErrorPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ChecklistItem } from '@/app/components/workflow/hooks/use-checklist'
import type { CommonEdgeType, CommonNodeType } from '@/app/components/workflow/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEdges, useNodes } from 'reactflow'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useChecklist } from '@/app/components/workflow/hooks/use-checklist'
import { useIsChatMode } from '@/app/components/workflow/hooks/use-workflow'
import { useStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowRunHistory } from '@/service/use-workflow'
import { useDifyBuilder } from './context'
import { DifyBuilderConversation } from './conversation'
import DifyBuilderModelSelector from './model-selector'
import { shouldStartBuildSession } from './utils'

const toChecklistErrorPayload = (item: ChecklistItem): DifyBuilderChecklistErrorPayload => ({
  node_id: item.id,
  node_type: String(item.type),
  title: item.title,
  messages: item.errorMessages,
  unconnected: !!item.unConnected,
  plugin_missing: !!item.isPluginMissing,
})

const DifyBuilderPanel = () => {
  const { t } = useTranslation()
  const appId = useStore((state) => state.appId)
  const setShowDifyBuilderPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const isChatMode = useIsChatMode()
  const nodes = useNodes<CommonNodeType>()
  const edges = useEdges<CommonEdgeType>()
  const flowType = useHooksStore((state) => state.configsMap?.flowType)
  const checklistItems = useChecklist(nodes, edges, { flowType })
  const { view, error, isBusy, startPrompt, submitAction, reset } = useDifyBuilder()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const historyUrl = appId
    ? isChatMode
      ? `/apps/${appId}/advanced-chat/workflow-runs`
      : `/apps/${appId}/workflow-runs`
    : undefined
  const { data: runHistoryData } = useWorkflowRunHistory(historyUrl, !!historyUrl)
  const latestFailedRun = useMemo(
    () => runHistoryData?.data.find((run) => run.status === WorkflowRunningStatus.Failed),
    [runHistoryData],
  )
  const fixableChecklistItems = useMemo(
    () =>
      checklistItems.filter(
        (item) => !item.unConnected && !item.isPluginMissing && item.errorMessages.length > 0,
      ),
    [checklistItems],
  )
  const buildMode = shouldStartBuildSession(nodes, edges.length)
  const canCompose = !view || view.run_status === 'complete' || view.run_status === 'failed'
  const checklistPayload = useMemo(
    () => ({
      passed: fixableChecklistItems.length === 0,
      remaining: checklistItems.map(toChecklistErrorPayload),
    }),
    [checklistItems, fixableChecklistItems.length],
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [isBusy, view?.conversation.length, view?.version])

  const send = useCallback(
    async (
      text: string,
      target?: { failedRunId: string } | { checklistErrors: DifyBuilderChecklistErrorPayload[] },
    ) => {
      if (!canCompose || isBusy) return
      const sent = await startPrompt(text, target)
      if (sent) setDraft('')
    },
    [canCompose, isBusy, startPrompt],
  )

  const promptSuggestions = useMemo(() => {
    const suggestions: Array<{
      label: string
      target?: { failedRunId: string } | { checklistErrors: DifyBuilderChecklistErrorPayload[] }
    }> = [
      {
        label: buildMode
          ? t(($) => $['difyBuilder.buildPrompt'], { ns: 'workflow' })
          : t(($) => $['difyBuilder.editPrompt'], { ns: 'workflow' }),
      },
    ]
    if (latestFailedRun) {
      suggestions.push({
        label: t(($) => $['difyBuilder.fixRunPrompt'], { ns: 'workflow' }),
        target: { failedRunId: latestFailedRun.id },
      })
    }
    if (fixableChecklistItems.length > 0) {
      suggestions.push({
        label: t(
          ($) =>
            $[
              fixableChecklistItems.length === 1
                ? 'difyBuilder.fixChecklistPrompt_one'
                : 'difyBuilder.fixChecklistPrompt_other'
            ],
          { ns: 'workflow', count: fixableChecklistItems.length },
        ),
        target: { checklistErrors: checklistItems.map(toChecklistErrorPayload) },
      })
    }
    return suggestions
  }, [buildMode, checklistItems, fixableChecklistItems.length, latestFailedRun, t])

  const composer = (
    <>
      {error && (
        <div
          role="alert"
          className="mb-2 rounded-lg bg-state-destructive-hover px-2 py-1.5 system-xs-regular text-text-destructive"
        >
          {error}
        </div>
      )}
      <div className="rounded-xl border border-components-input-border-active bg-components-input-bg-normal p-2 shadow-xs focus-within:border-components-input-border-active-prompt-1">
        <textarea
          value={draft}
          disabled={!canCompose || isBusy}
          aria-label={t(($) => $['difyBuilder.messagePlaceholder'], { ns: 'workflow' })}
          placeholder={
            canCompose
              ? t(($) => $['difyBuilder.messagePlaceholder'], { ns: 'workflow' })
              : t(($) => $['difyBuilder.useActions'], { ns: 'workflow' })
          }
          className="block h-16 w-full resize-none bg-transparent px-1 system-sm-regular text-text-primary outline-hidden placeholder:text-text-quaternary disabled:cursor-not-allowed"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || !draft.trim()) return
            event.preventDefault()
            void send(draft)
          }}
        />
        <div className="flex items-center justify-between gap-2 pt-1">
          <DifyBuilderModelSelector />
          <button
            type="button"
            disabled={!canCompose || isBusy || !draft.trim()}
            aria-label={t(($) => $['difyBuilder.messageSend'], { ns: 'workflow' })}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-components-button-primary-bg text-components-button-primary-text shadow-xs hover:bg-components-button-primary-bg-hover disabled:cursor-not-allowed disabled:bg-components-button-secondary-bg disabled:text-text-quaternary"
            onClick={() => void send(draft)}
          >
            <span aria-hidden className="i-ri-arrow-up-line size-4" />
          </button>
        </div>
      </div>
    </>
  )

  return (
    <aside
      aria-label={t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
      className="flex h-full w-90 shrink-0 flex-col overflow-hidden border-l border-components-panel-border bg-background-section"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-divider-subtle bg-components-panel-bg px-3">
        <h2 className="system-sm-semibold-uppercase text-text-primary">
          {t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={!view || view.run_status === 'executing' || isBusy}
            aria-label={t(($) => $['difyBuilder.reset'], { ns: 'workflow' })}
            className="flex size-7 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover disabled:cursor-not-allowed disabled:opacity-30"
            onClick={reset}
          >
            <span aria-hidden className="i-ri-reset-left-line size-4" />
          </button>
          <button
            type="button"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            className="flex size-7 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover"
            onClick={() => setShowDifyBuilderPanel(false)}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 grow overflow-y-auto">
        {!view ? (
          <div className="flex min-h-full flex-col justify-center px-6 py-8 text-left">
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl border border-util-colors-blue-blue-100 bg-util-colors-blue-blue-50 shadow-xs">
              <span
                aria-hidden
                className="i-ri-sparkling-fill size-5 text-util-colors-blue-blue-600"
              />
            </div>
            <h3 className="system-md-semibold text-text-primary">
              {buildMode
                ? t(($) => $['difyBuilder.emptyBuildTitle'], { ns: 'workflow' })
                : t(($) => $['difyBuilder.emptyEditTitle'], { ns: 'workflow' })}
            </h3>
            <p className="mt-1 max-w-72 system-xs-regular leading-5 text-text-tertiary">
              {t(($) => $['difyBuilder.emptyDescription'], { ns: 'workflow' })}
            </p>
            <div className="mt-5 flex w-full flex-col items-start gap-2">
              {promptSuggestions.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  disabled={isBusy}
                  className="w-fit rounded-lg border border-components-button-secondary-border bg-components-button-secondary-bg px-2 py-1.5 text-left system-xs-medium text-text-secondary shadow-xs hover:bg-components-button-secondary-bg-hover disabled:opacity-50"
                  onClick={() => void send(suggestion.label, suggestion.target)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
            <div className="mt-5 w-full">{composer}</div>
          </div>
        ) : (
          <DifyBuilderConversation
            items={view.conversation}
            actions={view.actions}
            busy={isBusy || view.run_status === 'executing'}
            interrupted={view.interrupted}
            checklistPayload={checklistPayload}
            onAction={submitAction}
          />
        )}
      </div>

      {view && <footer className="shrink-0 bg-background-section p-3">{composer}</footer>}
    </aside>
  )
}

export default DifyBuilderPanel
