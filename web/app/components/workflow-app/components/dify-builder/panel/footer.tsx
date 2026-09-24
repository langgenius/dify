import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DifyBuilderComposer from '../composer'
import { DifyBuilderInteractionDock } from '../interactions/interaction-dock'
import {
  difyBuilderActiveInteractionAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDecisionAtom,
  difyBuilderErrorAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderInteractionRefAtom,
  difyBuilderLocalInteractionResponseAtom,
  difyBuilderRecheckReadyAtom,
  difyBuilderRecoveryAtom,
  difyBuilderRetryCanvasRefreshAtom,
  difyBuilderSessionIdAtom,
  difyBuilderSubmitActionAtom,
  difyBuilderViewVersionAtom,
} from '../store'

const AnimatedInteractionDock = ({
  children,
  visible,
}: {
  children: ReactNode
  visible: boolean
}) => {
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(visible))
    return () => cancelAnimationFrame(frame)
  }, [visible])

  return (
    <div
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      className={cn(
        'transition-[opacity,transform] ease-out motion-reduce:translate-y-0',
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

export const DifyBuilderPanelFooter = () => {
  const { t } = useTranslation(['common'])
  const canvasRefreshFailed = useAtomValue(difyBuilderCanvasRefreshFailedAtom)
  const canvasRefreshing = useAtomValue(difyBuilderCanvasRefreshingAtom)
  const canvasReady = useAtomValue(difyBuilderCanvasReadyAtom)
  const activeInteraction = useAtomValue(difyBuilderActiveInteractionAtom)
  const interactionRef = useAtomValue(difyBuilderInteractionRefAtom)
  const decision = useAtomValue(difyBuilderDecisionAtom)
  const error = useAtomValue(difyBuilderErrorAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const localInteractionResponse = useAtomValue(difyBuilderLocalInteractionResponseAtom)
  const recheckReady = useAtomValue(difyBuilderRecheckReadyAtom)
  const recovery = useAtomValue(difyBuilderRecoveryAtom)
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const viewVersion = useAtomValue(difyBuilderViewVersionAtom)
  const retryCanvasRefresh = useSetAtom(difyBuilderRetryCanvasRefreshAtom)
  const submitInteraction = useSetAtom(difyBuilderSubmitActionAtom)
  const interactionPending = Boolean(interactionRef || decision)
  const interactionSubmitted = Boolean(
    localInteractionResponse?.sessionId === sessionId &&
    localInteractionResponse.baseVersion === viewVersion,
  )
  const interactionVisible = interactionPending && !interactionSubmitted
  const interactionKey = interactionRef
    ? `${sessionId}:${interactionRef.action_id}:${interactionRef.card_seq}`
    : decision
      ? `${sessionId}:choice:${viewVersion}`
      : 'composer'

  return (
    <footer className="relative z-10 shrink-0 pb-2">
      {recovery?.message && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded-lg bg-state-warning-hover px-2 py-1.5 system-xs-regular text-text-warning"
        >
          {recovery.message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mx-4 mb-2 rounded-lg bg-state-destructive-hover px-2 py-1.5 system-xs-regular text-text-destructive"
        >
          {error}
        </div>
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
        {interactionPending && (
          <AnimatedInteractionDock key={interactionKey} visible={interactionVisible}>
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
        {!interactionPending && <DifyBuilderComposer />}
      </div>
    </footer>
  )
}
