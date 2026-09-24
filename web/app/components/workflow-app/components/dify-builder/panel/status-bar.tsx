import type { Phase, RunStatus } from '@dify/contracts/api/console/dify-builder/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

const PHASE_LABEL_KEYS = {
  clarify: 'difyBuilder.status.clarifying',
  complete: 'difyBuilder.status.done',
  modify: 'difyBuilder.status.editing',
  plan: 'difyBuilder.status.planning',
  publish: 'difyBuilder.status.publishing',
  resources: 'difyBuilder.status.planning',
  review: 'difyBuilder.status.review',
  test: 'difyBuilder.status.testing',
  understand: 'difyBuilder.status.reading',
} as const satisfies Record<Phase, string>

const WAIT_LABEL_KEYS = {
  paused: 'difyBuilder.status.paused',
  waiting_confirmation: 'difyBuilder.status.waitingForConfirmation',
  waiting_input: 'difyBuilder.status.waitingForInput',
} as const

export const DifyBuilderStatusBar = ({
  phase,
  runStatus,
}: {
  phase?: Phase
  runStatus?: RunStatus
}) => {
  const { t } = useTranslation(['workflow'])
  if (!phase || !runStatus) return null

  const terminal = runStatus === 'complete' || runStatus === 'failed'
  const labelKey =
    runStatus === 'complete'
      ? 'difyBuilder.status.done'
      : runStatus === 'failed'
        ? 'difyBuilder.status.failed'
        : PHASE_LABEL_KEYS[phase]
  const label = t(($) => $[labelKey], { ns: 'workflow' })

  if (terminal) {
    return (
      <div
        role="status"
        aria-label={label}
        className={cn(
          'mx-4 mb-1.5 flex h-6 items-center gap-2 px-0.5 system-xs-medium',
          runStatus === 'complete' ? 'text-text-secondary' : 'text-text-destructive',
        )}
      >
        <span>{label}</span>
      </div>
    )
  }

  const waitLabelKey =
    runStatus === 'paused' || runStatus === 'waiting_confirmation' || runStatus === 'waiting_input'
      ? WAIT_LABEL_KEYS[runStatus]
      : undefined
  const waitLabel = waitLabelKey ? t(($) => $[waitLabelKey], { ns: 'workflow' }) : undefined
  const activeLabel = waitLabel ? `${label} · ${waitLabel}` : label

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={activeLabel}
      className="mx-4 mb-1.5 flex h-6 items-center gap-2 overflow-hidden px-0.5 text-text-secondary"
    >
      <span className="shrink-0 system-xs-medium">{label}</span>
      {waitLabel && (
        <>
          <span aria-hidden className="system-xs-regular text-text-quaternary">
            ·
          </span>
          <span className="system-xs-regular text-text-tertiary">{waitLabel}</span>
        </>
      )}
    </div>
  )
}
