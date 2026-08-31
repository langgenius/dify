import type { Action } from '@/app/components/dify-builder/contract/types'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { AgentBuildGridTexture } from '@/features/agent-v2/agent-detail/configure/components/build-grid-texture'
import { DifyBuilderConversation } from './conversation'
import { getDefaultActionPayload, isClientOnlyAction } from './interactions/action-payload'
import DifyBuilderModelSelector from './model-selector'
import {
  difyBuilderActionsAtom,
  difyBuilderCanComposeAtom,
  difyBuilderConversationAtom,
  difyBuilderErrorAtom,
  difyBuilderHasSessionAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderInterruptedAtom,
  difyBuilderResetAtom,
  difyBuilderStartPromptAtom,
  difyBuilderSubmitActionAtom,
  difyBuilderViewVersionAtom,
} from './store'

const DifyBuilderActionBar = ({
  actions,
  busy,
  changesExpanded,
  pendingActionId,
  onAction,
}: {
  actions: Action[]
  busy: boolean
  changesExpanded: boolean
  pendingActionId: string | null
  onAction: (action: Action) => void
}) => {
  const visibleActions = actions.filter((action) => action.kind !== 'automatic')
  if (visibleActions.length === 0) return null

  return (
    <div className="flex flex-col items-end gap-1 px-4 pb-2">
      {visibleActions.map((action) => {
        const loading = pendingActionId === action.id
        return (
          <Button
            key={action.id}
            size="small"
            variant="secondary"
            tone={action.kind === 'destructive' ? 'destructive' : 'default'}
            loading={loading}
            disabled={loading ? false : busy || pendingActionId !== null}
            aria-expanded={action.id === 'view_changes' ? changesExpanded : undefined}
            onClick={() => onAction(action)}
          >
            {action.label}
          </Button>
        )
      })}
    </div>
  )
}

const DifyBuilderPanel = () => {
  const { t } = useTranslation()
  const setShowDifyBuilderPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const actions = useAtomValue(difyBuilderActionsAtom)
  const canCompose = useAtomValue(difyBuilderCanComposeAtom)
  const conversation = useAtomValue(difyBuilderConversationAtom)
  const error = useAtomValue(difyBuilderErrorAtom)
  const hasSession = useAtomValue(difyBuilderHasSessionAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const interrupted = useAtomValue(difyBuilderInterruptedAtom)
  const viewVersion = useAtomValue(difyBuilderViewVersionAtom)
  const reset = useSetAtom(difyBuilderResetAtom)
  const startPrompt = useSetAtom(difyBuilderStartPromptAtom)
  const submitAction = useSetAtom(difyBuilderSubmitActionAtom)
  const [draft, setDraft] = useState('')
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [changesExpanded, setChangesExpanded] = useState(false)
  const [actionPayloads, setActionPayloads] = useState<Record<string, Record<string, unknown>>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [conversation.length, interactionBusy, viewVersion])

  const send = useCallback(async () => {
    const prompt = draft.trim()
    if (!prompt || !canCompose) return
    const sent = await startPrompt(prompt)
    if (sent) setDraft('')
  }, [canCompose, draft, startPrompt])

  const handleAction = useCallback(
    async (action: Action) => {
      if (interactionBusy || pendingActionId !== null) return
      if (isClientOnlyAction(action.id)) {
        setChangesExpanded((expanded) => !expanded)
        return
      }

      setPendingActionId(action.id)
      try {
        const payload =
          actionPayloads[action.id] ?? getDefaultActionPayload(action.id, conversation)
        const submitted = await submitAction(action.id, payload)
        if (submitted) {
          setActionPayloads((current) => {
            const next = { ...current }
            delete next[action.id]
            return next
          })
        }
      } finally {
        setPendingActionId(null)
      }
    },
    [actionPayloads, conversation, interactionBusy, pendingActionId, submitAction],
  )

  const handleReset = () => {
    reset()
    setDraft('')
    setPendingActionId(null)
    setChangesExpanded(false)
    setActionPayloads({})
  }

  return (
    <aside
      aria-label={t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
      className="flex h-full w-90 shrink-0 bg-background-body py-1 pr-1"
    >
      <div className="relative flex min-w-0 grow flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-background-section shadow-xl">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <AgentBuildGridTexture className="absolute top-0 right-0" />
          <AgentBuildGridTexture className="absolute right-0 bottom-0 origin-center scale-y-[-1]" />
        </div>

        <header className="relative z-10 flex h-11 shrink-0 items-center justify-between bg-gradient-to-b from-background-section to-transparent pr-3 pl-[18px]">
          <div className="relative flex h-full items-center gap-1 system-xs-semibold-uppercase text-text-primary after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-text-accent">
            <span
              aria-hidden
              className="i-custom-public-app-builder-builder-mark size-4 shrink-0"
            />
            <h2>{t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}</h2>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={!hasSession || interactionBusy}
              aria-label={t(($) => $['difyBuilder.reset'], { ns: 'workflow' })}
              className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-30"
              onClick={handleReset}
            >
              <span aria-hidden className="i-ri-reset-left-line size-4" />
            </button>
            <span aria-hidden className="h-3.5 w-px bg-divider-regular" />
            <button
              type="button"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid"
              onClick={() => setShowDifyBuilderPanel(false)}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="relative z-10 min-h-0 grow overflow-y-auto">
          {hasSession ? (
            <DifyBuilderConversation
              items={conversation}
              busy={interactionBusy}
              changesExpanded={changesExpanded}
              interrupted={interrupted}
              onActionPayloadChange={(actionId, payload) =>
                setActionPayloads((current) => ({ ...current, [actionId]: payload }))
              }
            />
          ) : (
            <div className="flex min-h-full flex-col items-center justify-center px-8 pb-8 text-center">
              <span aria-hidden className="mb-3 i-custom-public-app-builder-builder-mark size-8" />
              <h3 className="system-sm-semibold text-text-primary">
                {t(($) => $['difyBuilder.emptyBuildTitle'], { ns: 'workflow' })}
              </h3>
              <p className="mt-1 max-w-[284px] text-sm leading-5 tracking-[-0.07px] text-text-tertiary">
                {t(($) => $['difyBuilder.emptyDescription'], { ns: 'workflow' })}
              </p>
            </div>
          )}
        </div>

        <footer className="relative z-10 shrink-0 pb-2">
          {error && (
            <div
              role="alert"
              className="mx-4 mb-2 rounded-lg bg-state-destructive-hover px-2 py-1.5 system-xs-regular text-text-destructive"
            >
              {error}
            </div>
          )}
          <DifyBuilderActionBar
            actions={actions}
            busy={interactionBusy}
            changesExpanded={changesExpanded}
            pendingActionId={pendingActionId}
            onAction={(action) => void handleAction(action)}
          />
          <div className="mx-4 h-21 overflow-hidden rounded-xl border border-components-chat-input-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px] focus-within:border-components-input-border-active-prompt-1">
            <div className="flex h-full flex-col items-end justify-end p-1.5">
              <textarea
                value={draft}
                disabled={!canCompose}
                aria-label={t(($) => $['difyBuilder.messagePlaceholder'], { ns: 'workflow' })}
                placeholder={
                  canCompose
                    ? t(($) => $['difyBuilder.messagePlaceholder'], { ns: 'workflow' })
                    : t(($) => $['difyBuilder.useActions'], { ns: 'workflow' })
                }
                className="block min-h-10 w-full grow resize-none bg-transparent px-2 py-1 text-sm leading-5 tracking-[-0.07px] text-text-primary caret-[#295EFF] outline-hidden placeholder:text-text-placeholder disabled:cursor-not-allowed"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey || !draft.trim()) return
                  event.preventDefault()
                  void send()
                }}
              />
              <div className="flex h-8 w-full shrink-0 items-center justify-between gap-2 pl-1">
                <DifyBuilderModelSelector />
                <button
                  type="button"
                  disabled={!canCompose || !draft.trim()}
                  aria-label={t(($) => $['difyBuilder.messageSend'], { ns: 'workflow' })}
                  className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border-[0.5px] border-components-button-primary-border bg-components-button-primary-bg text-components-button-primary-text outline-hidden hover:border-components-button-primary-border-hover hover:bg-components-button-primary-bg-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:border-components-button-primary-border-disabled disabled:bg-components-button-primary-bg-disabled disabled:text-components-button-primary-text-disabled"
                  onClick={() => void send()}
                >
                  <span aria-hidden className="i-ri-send-plane-2-fill size-4" />
                </button>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </aside>
  )
}

export default DifyBuilderPanel
