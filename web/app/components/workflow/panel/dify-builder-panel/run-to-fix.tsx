import type { WorkflowRunHistory } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

export type RunToFixProps = {
  isRunHistoryLoading: boolean
  latestFailedRun?: WorkflowRunHistory
  manualRunId: string
  onManualRunIdChange: (value: string) => void
  canStartFix: boolean
  isStarting: boolean
  onStartFix: () => void
}

function RunToFix({
  isRunHistoryLoading,
  latestFailedRun,
  manualRunId,
  onManualRunIdChange,
  canStartFix,
  isStarting,
  onStartFix,
}: RunToFixProps) {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const usesAutoDetectedRun = !manualRunId.trim() && !!latestFailedRun

  return (
    <div className="flex flex-col gap-y-3 px-4 py-3">
      <div className="system-sm-semibold-uppercase text-text-secondary">
        {t(($) => $['difyBuilder.runToFixTitle'], { ns: 'workflow' })}
      </div>
      <div className="rounded-lg border border-components-panel-border bg-components-panel-bg px-3 py-2">
        <div className="system-xs-medium text-text-tertiary">
          {t(($) => $['difyBuilder.runToFixAutoLabel'], { ns: 'workflow' })}
        </div>
        {isRunHistoryLoading && (
          <div className="system-sm-regular mt-1 text-text-quaternary">
            {t(($) => $['difyBuilder.runToFixAutoLoading'], { ns: 'workflow' })}
          </div>
        )}
        {!isRunHistoryLoading && latestFailedRun && (
          <div className="mt-1 flex items-center justify-between gap-x-2">
            <div className="min-w-0">
              <div className="system-sm-medium truncate text-text-primary">
                {latestFailedRun.id}
              </div>
              <div className="system-xs-regular text-text-tertiary">
                {formatTimeFromNow((latestFailedRun.finished_at || latestFailedRun.created_at) * 1000)}
              </div>
            </div>
          </div>
        )}
        {!isRunHistoryLoading && !latestFailedRun && (
          <div className="system-sm-regular mt-1 text-text-quaternary">
            {t(($) => $['difyBuilder.runToFixAutoEmpty'], { ns: 'workflow' })}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 system-xs-medium text-text-tertiary">
          {t(($) => $['difyBuilder.runToFixManualLabel'], { ns: 'workflow' })}
        </div>
        <Input
          size="small"
          value={manualRunId}
          onChange={(e) => onManualRunIdChange(e.target.value)}
          placeholder={t(($) => $['difyBuilder.runToFixManualPlaceholder'], { ns: 'workflow' })}
        />
      </div>
      <Button
        variant="primary"
        size="small"
        disabled={!canStartFix || isStarting}
        loading={isStarting}
        onClick={onStartFix}
      >
        {isStarting
          ? t(($) => $['difyBuilder.starting'], { ns: 'workflow' })
          : usesAutoDetectedRun
            ? t(($) => $['difyBuilder.useThisRun'], { ns: 'workflow' })
            : t(($) => $['difyBuilder.startFix'], { ns: 'workflow' })}
      </Button>
    </div>
  )
}

export default memo(RunToFix)
