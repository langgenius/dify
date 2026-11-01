import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { useStore } from '@/app/components/workflow/store'
import { DifyBuilderAttachmentScope } from './attachments'
import { DifyBuilderConversation } from './conversation'
import { DifyBuilderLocaleProvider } from './interactions/locale-provider'
import { useDifyBuilderInteractionLocale } from './interactions/use-interaction-locale'
import { DifyBuilderPanelBackground } from './panel/background'
import { DifyBuilderPanelEmptyState } from './panel/empty-state'
import { DifyBuilderPanelFooter } from './panel/footer'
import { DifyBuilderPanelHeader } from './panel/header'
import {
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderConversationLoadingAtom,
  difyBuilderLocalUserMessageAtom,
  difyBuilderSessionViewAtom,
} from './session/state'
import {
  difyBuilderAbandonTaskAtom,
  difyBuilderCanAbandonTaskAtom,
  difyBuilderCanClearConversationAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderClearConversationAtom,
  difyBuilderHasSessionAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderInterruptedAtom,
  difyBuilderLoadOlderConversationAtom,
  difyBuilderLocalInteractionResponseAtom,
  difyBuilderSessionIdAtom,
  difyBuilderViewVersionAtom,
} from './store'

const AUTO_SCROLL_BOTTOM_THRESHOLD = 24
const DifyBuilderPanelContent = () => {
  const locale = useDifyBuilderInteractionLocale()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const setShowDifyBuilderPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const view = useAtomValue(difyBuilderSessionViewAtom)
  const conversation = useAtomValue(difyBuilderConversationAtom)
  const conversationHasMore = useAtomValue(difyBuilderConversationHasMoreAtom)
  const conversationLoading = useAtomValue(difyBuilderConversationLoadingAtom)
  const localUserMessage = useAtomValue(difyBuilderLocalUserMessageAtom)
  const localInteractionResponse = useAtomValue(difyBuilderLocalInteractionResponseAtom)
  const hasSession = useAtomValue(difyBuilderHasSessionAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const canClearConversation = useAtomValue(difyBuilderCanClearConversationAtom)
  const canvasReady = useAtomValue(difyBuilderCanvasReadyAtom)
  const interrupted = useAtomValue(difyBuilderInterruptedAtom)
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const viewVersion = useAtomValue(difyBuilderViewVersionAtom)
  const clearConversation = useSetAtom(difyBuilderClearConversationAtom)
  const abandonTask = useSetAtom(difyBuilderAbandonTaskAtom)
  const canAbandonTask = useAtomValue(difyBuilderCanAbandonTaskAtom)
  const [confirmation, setConfirmation] = useState<'clear' | 'abandon' | null>(null)
  const loadOlderConversation = useSetAtom(difyBuilderLoadOlderConversationAtom)
  const panelTitleRef = useRef<HTMLHeadingElement>(null)
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

  const handleReset = async () => {
    const operation = confirmation
    setConfirmation(null)
    if (operation === 'abandon') await abandonTask()
    else if (operation === 'clear' && (await clearConversation())) pinnedToBottomRef.current = true
  }

  return (
    <aside
      aria-label={t(($) => $.panelTitle, { ns: 'difyBuilder' })}
      className="flex h-full w-100 shrink-0 bg-background-body py-1 pe-1"
    >
      <div className="relative flex min-w-0 grow flex-col overflow-hidden rounded-xl shadow-xl inset-ring-[0.5px] inset-ring-components-panel-border">
        <DifyBuilderPanelBackground />

        <DifyBuilderPanelHeader
          resetDisabled={!canClearConversation}
          abandonDisabled={!canAbandonTask}
          titleRef={panelTitleRef}
          onReset={() => setConfirmation('clear')}
          onAbandon={() => setConfirmation('abandon')}
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
                    onClick={() => void handleLoadOlderConversation()}
                  >
                    {t(($) => $['operation.more'], { ns: 'common' })}
                  </Button>
                </div>
              )}
              <ErrorBoundary key={sessionId}>
                <Suspense
                  fallback={
                    <SkeletonContainer
                      role="status"
                      aria-label={t(($) => $.loading, { ns: 'common' })}
                      className="gap-3 px-4 py-4"
                    >
                      <SkeletonRectangle aria-hidden className="h-4 w-1/2" />
                      <SkeletonRectangle aria-hidden className="h-4 w-full" />
                      <SkeletonRectangle aria-hidden className="h-4 w-3/4" />
                    </SkeletonContainer>
                  }
                >
                  <DifyBuilderConversation
                    items={conversation}
                    attachments={view?.conversation_cleared ? [] : view?.attachments}
                    localInteractionResponse={
                      localInteractionResponse?.sessionId === sessionId
                        ? localInteractionResponse
                        : null
                    }
                    localUserMessage={
                      localUserMessage?.sessionId === null ||
                      localUserMessage?.sessionId === sessionId
                        ? localUserMessage
                        : null
                    }
                    busy={interactionBusy || !canvasReady}
                    interrupted={interrupted}
                    onStreamingContentChange={scrollToBottomIfPinned}
                  />
                </Suspense>
              </ErrorBoundary>
            </>
          ) : (
            <DifyBuilderPanelEmptyState />
          )}
        </div>

        <DifyBuilderPanelFooter focusTargetRef={panelTitleRef} />
        <AlertDialog
          open={confirmation !== null}
          onOpenChange={(open) => !open && setConfirmation(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirmation === 'abandon'
                  ? t(($) => $['taskControl.abandon'], { ns: 'difyBuilder' })
                  : t(($) => $.reset, { ns: 'difyBuilder' })}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton onClick={() => void handleReset()}>
                {t(($) => $['operation.confirm'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </aside>
  )
}

const DifyBuilderPanel = () => (
  <DifyBuilderAttachmentScope>
    <DifyBuilderLocaleProvider>
      <DifyBuilderPanelContent />
    </DifyBuilderLocaleProvider>
  </DifyBuilderAttachmentScope>
)

export default DifyBuilderPanel
