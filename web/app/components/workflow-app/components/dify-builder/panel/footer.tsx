import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import DifyBuilderComposer from '../composer'
import {
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderErrorAtom,
  difyBuilderInteractionBusyAtom,
  difyBuilderPhaseAtom,
  difyBuilderRecoveryAtom,
  difyBuilderRetryCanvasRefreshAtom,
  difyBuilderRunStatusAtom,
} from '../store'
import { DifyBuilderStatusBar } from './status-bar'

export const DifyBuilderPanelFooter = () => {
  const { t } = useTranslation()
  const canvasRefreshFailed = useAtomValue(difyBuilderCanvasRefreshFailedAtom)
  const canvasRefreshing = useAtomValue(difyBuilderCanvasRefreshingAtom)
  const error = useAtomValue(difyBuilderErrorAtom)
  const interactionBusy = useAtomValue(difyBuilderInteractionBusyAtom)
  const phase = useAtomValue(difyBuilderPhaseAtom)
  const recovery = useAtomValue(difyBuilderRecoveryAtom)
  const runStatus = useAtomValue(difyBuilderRunStatusAtom)
  const retryCanvasRefresh = useSetAtom(difyBuilderRetryCanvasRefreshAtom)

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
      <DifyBuilderStatusBar phase={phase} runStatus={runStatus} />
      <DifyBuilderComposer />
    </footer>
  )
}
