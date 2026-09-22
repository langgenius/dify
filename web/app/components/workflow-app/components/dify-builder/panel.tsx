import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import { DifyBuilderConversation } from './conversation'
import { DifyBuilderPanelBackground } from './panel/background'
import { DifyBuilderPanelEmptyState } from './panel/empty-state'
import { DifyBuilderPanelFooter } from './panel/footer'
import { DifyBuilderPanelHeader } from './panel/header'
import {
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderLocalUserMessageAtom,
} from './session/state'
import {
  difyBuilderCanvasReadyAtom,
  difyBuilderHasSessionAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderInterruptedAtom,
  difyBuilderLoadOlderConversationAtom,
  difyBuilderLocalInteractionResponseAtom,
  difyBuilderResetAtom,
  difyBuilderSessionIdAtom,
  difyBuilderViewVersionAtom,
} from './store'

const AUTO_SCROLL_BOTTOM_THRESHOLD = 24
const DifyBuilderPanel = () => {
  const { t } = useTranslation()
  const setShowDifyBuilderPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const conversation = useAtomValue(difyBuilderConversationAtom)
  const conversationHasMore = useAtomValue(difyBuilderConversationHasMoreAtom)
  const conversationLoading = useAtomValue(difyBuilderConversationLoadingAtom)
  const localUserMessage = useAtomValue(difyBuilderLocalUserMessageAtom)
  const localInteractionResponse = useAtomValue(difyBuilderLocalInteractionResponseAtom)
  const hasSession = useAtomValue(difyBuilderHasSessionAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const canvasReady = useAtomValue(difyBuilderCanvasReadyAtom)
  const interrupted = useAtomValue(difyBuilderInterruptedAtom)
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const viewVersion = useAtomValue(difyBuilderViewVersionAtom)
  const reset = useSetAtom(difyBuilderResetAtom)
  const loadOlderConversation = useSetAtom(difyBuilderLoadOlderConversationAtom)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedToBottomRef = useRef(true)

  const scrollToBottomIfPinned = useCallback(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer || !pinnedToBottomRef.current) return
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight })
  }, [])

  useEffect(() => {
    scrollToBottomIfPinned()
  }, [
    conversation.length,
    interactionBusy,
    localInteractionResponse?.localId,
    localUserMessage?.localId,
    scrollToBottomIfPinned,
    viewVersion,
  ])

  const handleScroll = useCallback(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer) return
    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
    pinnedToBottomRef.current = distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD
  }, [])

  const handleLoadOlderConversation = useCallback(async () => {
    const scrollContainer = scrollRef.current
    const previousScrollHeight = scrollContainer?.scrollHeight ?? 0
    const loaded = await loadOlderConversation()
    if (!loaded || !scrollContainer) return
    requestAnimationFrame(() => {
      scrollContainer.scrollTop += scrollContainer.scrollHeight - previousScrollHeight
    })
  }, [loadOlderConversation])

  const handleReset = () => {
    reset()
    pinnedToBottomRef.current = true
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
                items={conversation}
                localInteractionResponse={
                  localInteractionResponse?.sessionId === sessionId
                    ? localInteractionResponse
                    : null
                }
                localUserMessage={
                  localUserMessage?.sessionId === null || localUserMessage?.sessionId === sessionId
                    ? localUserMessage
                    : null
                }
                busy={interactionBusy || !canvasReady}
                interrupted={interrupted}
                onStreamingContentChange={scrollToBottomIfPinned}
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
