import type { Action } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { DifyBuilderConversation } from './conversation'
import { FORM_ACTION_IDS, getDefaultActionPayload } from './interactions/action-payload'
import { DifyBuilderActionBar } from './panel/action-bar'
import { DifyBuilderPanelBackground } from './panel/background'
import { DifyBuilderPanelEmptyState } from './panel/empty-state'
import { DifyBuilderPanelFooter } from './panel/footer'
import { DifyBuilderPanelHeader } from './panel/header'
import {
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
} from './session/state'
import {
  difyBuilderActionsAtom,
  difyBuilderActiveInteractionAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderHasSessionAtom,
  difyBuilderInteractionAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderInterruptedAtom,
  difyBuilderLoadOlderConversationAtom,
  difyBuilderRecheckReadyAtom,
  difyBuilderResetAtom,
  difyBuilderSessionIdAtom,
  difyBuilderSubmitActionAtom,
  difyBuilderViewVersionAtom,
} from './store'

const AUTO_SCROLL_BOTTOM_THRESHOLD = 24
const EMPTY_ACTION_INTERACTION_STATE = {
  key: '',
  payloads: {} as Record<string, Record<string, unknown>>,
  validity: {} as Record<string, boolean>,
}

const DifyBuilderPanel = () => {
  const { t } = useTranslation()
  const setShowDifyBuilderPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const actions = useAtomValue(difyBuilderActionsAtom)
  const activeInteraction = useAtomValue(difyBuilderActiveInteractionAtom)
  const conversation = useAtomValue(difyBuilderConversationAtom)
  const conversationHasMore = useAtomValue(difyBuilderConversationHasMoreAtom)
  const conversationLoading = useAtomValue(difyBuilderConversationLoadingAtom)
  const hasSession = useAtomValue(difyBuilderHasSessionAtom)
  const interaction = useAtomValue(difyBuilderInteractionAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const canvasReady = useAtomValue(difyBuilderCanvasReadyAtom)
  const interrupted = useAtomValue(difyBuilderInterruptedAtom)
  const recheckReady = useAtomValue(difyBuilderRecheckReadyAtom)
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const viewVersion = useAtomValue(difyBuilderViewVersionAtom)
  const reset = useSetAtom(difyBuilderResetAtom)
  const loadOlderConversation = useSetAtom(difyBuilderLoadOlderConversationAtom)
  const submitAction = useSetAtom(difyBuilderSubmitActionAtom)
  const interactionFormId = useId()
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [actionInteractionState, setActionInteractionState] = useState(
    EMPTY_ACTION_INTERACTION_STATE,
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)
  const activeInteractionKey = interaction
    ? `${sessionId}:${interaction.action_id}:${interaction.card.seq}`
    : ''
  const activeFormActionId =
    activeInteraction?.card.kind === 'form' && FORM_ACTION_IDS.has(activeInteraction.action_id)
      ? activeInteraction.action_id
      : undefined
  const activeFormId = activeFormActionId ? `${interactionFormId}-interaction` : undefined
  const currentActionInteractionState =
    actionInteractionState.key === activeInteractionKey
      ? actionInteractionState
      : EMPTY_ACTION_INTERACTION_STATE
  const actionPayloads = currentActionInteractionState.payloads
  const actionValidity = useMemo(
    () =>
      interaction && !activeInteraction
        ? { ...currentActionInteractionState.validity, [interaction.action_id]: false }
        : currentActionInteractionState.validity,
    [activeInteraction, currentActionInteractionState.validity, interaction],
  )

  const scrollToBottomIfPinned = useCallback(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer || !pinnedToBottomRef.current) return
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight })
  }, [])

  useEffect(() => {
    scrollToBottomIfPinned()
  }, [conversation.length, interactionBusy, scrollToBottomIfPinned, viewVersion])

  const handleScroll = useCallback(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer) return
    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
    pinnedToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD
  }, [])

  const handleActionPayloadChange = useCallback(
    (actionId: string, payload: Record<string, unknown>) => {
      setActionInteractionState((current) => ({
        key: activeInteractionKey,
        payloads: {
          ...(current.key === activeInteractionKey ? current.payloads : {}),
          [actionId]: payload,
        },
        validity: current.key === activeInteractionKey ? current.validity : {},
      }))
    },
    [activeInteractionKey],
  )

  const handleActionValidityChange = useCallback(
    (actionId: string, valid: boolean) => {
      setActionInteractionState((current) => ({
        key: activeInteractionKey,
        payloads: current.key === activeInteractionKey ? current.payloads : {},
        validity: {
          ...(current.key === activeInteractionKey ? current.validity : {}),
          [actionId]: valid,
        },
      }))
    },
    [activeInteractionKey],
  )

  const handleLoadOlderConversation = useCallback(async () => {
    const scrollContainer = scrollRef.current
    const previousScrollHeight = scrollContainer?.scrollHeight ?? 0
    const loaded = await loadOlderConversation()
    if (!loaded || !scrollContainer) return
    requestAnimationFrame(() => {
      scrollContainer.scrollTop += scrollContainer.scrollHeight - previousScrollHeight
    })
  }, [loadOlderConversation])

  const handleAction = useCallback(
    async (action: Action) => {
      if (
        interactionBusy ||
        !canvasReady ||
        pendingActionId !== null ||
        actionValidity[action.id] === false
      )
        return

      setPendingActionId(action.id)
      try {
        const payload =
          actionPayloads[action.id] ?? getDefaultActionPayload(action.id, activeInteraction)
        const submitted = await submitAction(action.id, payload)
        if (submitted) {
          setActionInteractionState((current) => {
            if (current.key !== activeInteractionKey) return current
            const payloads = { ...current.payloads }
            const validity = { ...current.validity }
            delete payloads[action.id]
            delete validity[action.id]
            return { ...current, payloads, validity }
          })
        }
      } finally {
        setPendingActionId(null)
      }
    },
    [
      actionPayloads,
      actionValidity,
      activeInteraction,
      activeInteractionKey,
      canvasReady,
      interactionBusy,
      pendingActionId,
      submitAction,
    ],
  )

  const handleActiveFormSubmit = useCallback(() => {
    if (!activeFormActionId) return
    const action = actions.find((action) => action.id === activeFormActionId)
    if (action) void handleAction(action)
  }, [actions, activeFormActionId, handleAction])

  const handleReset = () => {
    reset()
    pinnedToBottomRef.current = true
    setPendingActionId(null)
    setActionInteractionState(EMPTY_ACTION_INTERACTION_STATE)
  }

  return (
    <aside
      aria-label={t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
      className="flex h-full w-100 shrink-0 bg-background-body py-1 pr-1"
    >
      <div className="relative flex min-w-0 grow flex-col overflow-hidden rounded-xl bg-background-section shadow-xl inset-ring-[0.5px] inset-ring-components-panel-border">
        <DifyBuilderPanelBackground />

        <DifyBuilderPanelHeader
          resetDisabled={!hasSession || interactionBusy}
          onReset={handleReset}
          onClose={() => setShowDifyBuilderPanel(false)}
        />

        <div
          ref={scrollRef}
          className="relative z-10 min-h-0 grow overflow-y-auto"
          onScroll={handleScroll}
        >
          {hasSession ? (
            <>
              {conversationHasMore && (
                <div className="flex justify-center px-4 pt-3">
                  <Button
                    size="small"
                    variant="secondary"
                    loading={conversationLoading}
                    disabled={conversationLoading}
                    onClick={() => void handleLoadOlderConversation()}
                  >
                    {t(($) => $['operation.more'], { ns: 'common' })}
                  </Button>
                </div>
              )}
              <DifyBuilderConversation
                key={sessionId}
                activeInteraction={interaction}
                viewVersion={viewVersion}
                items={conversation}
                busy={interactionBusy || !canvasReady}
                interrupted={interrupted}
                activeFormId={activeFormId}
                onActionPayloadChange={handleActionPayloadChange}
                onActionValidityChange={handleActionValidityChange}
                onActiveFormSubmit={handleActiveFormSubmit}
                onStreamingContentChange={scrollToBottomIfPinned}
              />
              <DifyBuilderActionBar
                actionValidity={actionValidity}
                actions={actions}
                busy={interactionBusy || !canvasReady}
                formActionId={activeFormActionId}
                formId={activeFormId}
                pendingActionId={pendingActionId}
                recheckReady={recheckReady}
                onAction={(action) => void handleAction(action)}
              />
            </>
          ) : (
            <DifyBuilderPanelEmptyState />
          )}
        </div>

        <DifyBuilderPanelFooter />
      </div>
    </aside>
  )
}

export default DifyBuilderPanel
