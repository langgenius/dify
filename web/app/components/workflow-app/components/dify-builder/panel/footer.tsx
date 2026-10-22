import type { ReactNode, RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import DifyBuilderComposer from '../composer'
import { useBuilderText } from '../copy/use-builder-text'
import { DifyBuilderInteractionDock } from '../interactions/interaction-dock'
import { difyBuilderSessionBusyAtom } from '../session/state'
import {
  difyBuilderActiveInteractionAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDecisionAtom,
  difyBuilderErrorAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderInteractionRefAtom,
  difyBuilderInterruptedAtom,
  difyBuilderLocalInteractionResponseAtom,
  difyBuilderNativeCancelAtom,
  difyBuilderRecheckReadyAtom,
  difyBuilderRetryCanvasRefreshAtom,
  difyBuilderRunActiveAtom,
  difyBuilderSessionIdAtom,
  difyBuilderSubmitActionAtom,
  difyBuilderTestExecutionAtom,
  difyBuilderViewVersionAtom,
} from '../store'

const AnimatedInteractionDock = ({
  children,
  focusTargetRef,
  visible,
}: {
  children: ReactNode
  focusTargetRef: RefObject<HTMLElement | null>
  visible: boolean
}) => {
  const dockRef = useRef<HTMLDivElement>(null)
  const [entered, setEntered] = useState(false)

  useLayoutEffect(() => {
    const dock = dockRef.current
    if (!dock) return

    // Move focus before either attribute hides the focused control from accessibility APIs.
    if (!visible && dock.contains(dock.ownerDocument.activeElement)) {
      focusTargetRef.current?.focus({ preventScroll: true })
    }
    dock.inert = !visible
    if (visible) dock.removeAttribute('aria-hidden')
    else dock.setAttribute('aria-hidden', 'true')
  }, [focusTargetRef, visible])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(visible))
    return () => cancelAnimationFrame(frame)
  }, [visible])

  return (
    <div
      ref={dockRef}
      className={cn(
        'transition-[opacity,transform] ease-out motion-reduce:translate-y-0 motion-reduce:duration-0',
        visible && entered
          ? 'translate-y-0 opacity-100 duration-160'
          : 'translate-y-3 opacity-0 duration-120',
        !visible && 'pointer-events-none absolute inset-x-0 bottom-0',
      )}
    >
      {children}
    </div>
  )
}

export const DifyBuilderPanelFooter = ({
  focusTargetRef,
}: {
  focusTargetRef: RefObject<HTMLElement | null>
}) => {
  const { locale, renderText } = useBuilderText()
  const { t } = useTranslation(['common', 'difyBuilder'], { lng: locale })
  const testExecution = useAtomValue(difyBuilderTestExecutionAtom)
  const nativeCancel = useAtomValue(difyBuilderNativeCancelAtom)
  const commandBusy = useAtomValue(difyBuilderSessionBusyAtom)
  const canvasRefreshFailed = useAtomValue(difyBuilderCanvasRefreshFailedAtom)
  const canvasRefreshing = useAtomValue(difyBuilderCanvasRefreshingAtom)
  const canvasReady = useAtomValue(difyBuilderCanvasReadyAtom)
  const activeInteraction = useAtomValue(difyBuilderActiveInteractionAtom)
  const interactionRef = useAtomValue(difyBuilderInteractionRefAtom)
  const decision = useAtomValue(difyBuilderDecisionAtom)
  const error = useAtomValue(difyBuilderErrorAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const interrupted = useAtomValue(difyBuilderInterruptedAtom)
  const localInteractionResponse = useAtomValue(difyBuilderLocalInteractionResponseAtom)
  const recheckReady = useAtomValue(difyBuilderRecheckReadyAtom)
  const runActive = useAtomValue(difyBuilderRunActiveAtom)
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const viewVersion = useAtomValue(difyBuilderViewVersionAtom)
  const retryCanvasRefresh = useSetAtom(difyBuilderRetryCanvasRefreshAtom)
  const submitInteraction = useSetAtom(difyBuilderSubmitActionAtom)
  const interactionPending = Boolean(interactionRef || decision)
  const interactionSubmitted = Boolean(
    localInteractionResponse?.sessionId === sessionId &&
    localInteractionResponse.baseVersion === viewVersion,
  )
  const interactionVisible =
    interactionPending && !interactionSubmitted && (!runActive || interrupted)
  const interactionKey = interactionRef
    ? `${sessionId}:${interactionRef.action_id}:${interactionRef.card_seq}`
    : decision
      ? `${sessionId}:choice:${viewVersion}`
      : 'composer'

  return (
    <footer className="relative z-10 shrink-0 pb-2">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full h-6 bg-linear-to-t from-background-gradient-bg-fill-chat-bg-2 to-transparent"
      />
      {error && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded-lg bg-state-destructive-hover px-2 py-1.5 system-xs-regular text-text-destructive"
        >
          {error}
        </div>
      )}
      {testExecution?.outcome === 'unknown' && (
        <p role="status" className="mx-4 mb-2 system-xs-regular text-text-warning">
          {renderText({ type: 'copy', id: 'confirmed.unknown' })}
        </p>
      )}
      {(testExecution?.resume_blocked_reason === 'native_resolution_unavailable' ||
        (testExecution?.status === 'waiting' && testExecution.wait_reason === 'configuration')) && (
        <p role="status" className="mx-4 mb-2 system-xs-regular text-text-secondary">
          {t(($) => $['testResult.configurationRequired'], { ns: 'difyBuilder' })}
        </p>
      )}
      {testExecution?.cancellation?.status === 'cancelling' ? (
        <p role="status" className="mx-4 mb-2 system-xs-regular text-text-secondary">
          {t(($) => $['testResult.cancelling'], { ns: 'difyBuilder' })}
        </p>
      ) : (
        nativeCancel && (
          <div className="mx-4 mb-2 flex justify-end">
            <Button
              size="small"
              disabled={commandBusy}
              onClick={() => {
                void submitInteraction('cancel_test', nativeCancel.payload ?? {}, {
                  renderText,
                  replyLanguage: locale,
                  booleanTrue: '',
                  booleanFalse: '',
                  noResourcesSelected: '',
                })
              }}
            >
              {renderText(nativeCancel.label)}
            </Button>
          </div>
        )
      )}
      {canvasRefreshFailed && (
        <div className="mx-4 mb-2 flex justify-end">
          <Button
            size="small"
            variant="secondary"
            loading={canvasRefreshing}
            disabled={interactionBusy && !canvasRefreshing}
            onClick={() => retryCanvasRefresh()}
          >
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      <div className="relative">
        <Suspense
          fallback={
            <SkeletonContainer
              role="status"
              aria-label={t(($) => $.loading, { ns: 'common' })}
              className="mx-4 gap-3 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4"
            >
              <SkeletonRectangle aria-hidden className="h-4 w-1/2" />
              <SkeletonRectangle aria-hidden className="h-18 w-full rounded-lg" />
            </SkeletonContainer>
          }
        >
          {interactionPending && (
            <AnimatedInteractionDock
              key={interactionKey}
              focusTargetRef={focusTargetRef}
              visible={interactionVisible}
            >
              <DifyBuilderInteractionDock
                activeInteraction={activeInteraction}
                busy={interactionBusy || !canvasReady}
                decision={decision}
                interactionPending={Boolean(interactionRef)}
                recheckReady={recheckReady}
                submitInteraction={submitInteraction}
              />
            </AnimatedInteractionDock>
          )}
          {!interactionVisible && <DifyBuilderComposer />}
        </Suspense>
      </div>
    </footer>
  )
}
