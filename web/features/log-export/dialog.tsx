import type { ConversationLogExportStatusResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps, ReactNode } from 'react'
import type { CloudSandboxPlanState } from './cloud-sandbox-retention'
import type { LogExportPhase } from './use-log-export'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import useTimestamp from '@/hooks/use-timestamp'
import { downloadUrl } from '@/utils/download'
import { LogExportProgressDialog } from './progress-dialog'

export function LogExportSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled: boolean
}) {
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => next && onChange(next)}
      disabled={disabled}
    >
      <div className="flex flex-col gap-1.5">
        <SelectLabel>{label}</SelectLabel>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
      </div>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type LastLogExportProps = {
  status: ConversationLogExportStatusResponse['status']
  fileUrl: string
  expiresAt?: string | null
  start?: string | null
  end?: string | null
  keyword?: string | null
  statusLabel?: string
  identities: string[]
  sources?: string[]
  onViewProgress?: () => void
}

function LastLogExport({
  fileUrl,
  expiresAt,
  status,
  start,
  end,
  keyword,
  statusLabel,
  identities,
  sources = [],
  onViewProgress,
  timezone,
}: LastLogExportProps & { timezone: string }) {
  const { t } = useTranslation(['appLog', 'common', 'time'])
  const { formatDate } = useTimestamp({ timezone })
  const title = t(($) => $['export.last'], { ns: 'appLog' })
  const startLabel = start && formatDate(start, 'YYYY-MM-DD HH:mm')
  const endLabel = end && formatDate(end, 'YYYY-MM-DD HH:mm')
  let range: string | undefined
  if (startLabel && endLabel) range = `${startLabel} – ${endLabel}`
  else if (startLabel) range = `${t(($) => $['picker.startDate'], { ns: 'time' })} ${startLabel}`
  else if (endLabel) range = `${t(($) => $['picker.endDate'], { ns: 'time' })} ${endLabel}`

  const summary = [
    range,
    keyword && `${t(($) => $['operation.search'], { ns: 'common' })} “${keyword}”`,
    statusLabel,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      role="group"
      aria-label={title}
      className="flex items-center justify-between gap-3 rounded-lg bg-background-section-burn px-3 py-2.5"
    >
      <div className="min-w-0 space-y-1">
        <p className="system-sm-medium text-text-primary">{title}</p>
        {(summary || (identities.length === 0 && sources.length === 0)) && (
          <p className="system-sm-regular wrap-anywhere text-text-secondary">
            {summary || t(($) => $['export.all'], { ns: 'appLog' })}
          </p>
        )}
        {sources.length > 0 && (
          <p className="truncate system-sm-regular text-text-secondary">{sources.join(', ')}</p>
        )}
        {identities.length > 0 && (
          <p className="truncate system-sm-regular text-text-secondary">{identities.join(', ')}</p>
        )}
        {status === 'ready' && expiresAt && (
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['export.expiresAt'], {
              ns: 'appLog',
              date: formatDate(expiresAt, 'YYYY-MM-DD HH:mm'),
            })}
          </p>
        )}
        {status === 'pending' && (
          <p role="status" className="system-sm-regular text-text-secondary">
            {t(($) => $['export.progressQueued'], { ns: 'appLog' })}
          </p>
        )}
        {status === 'processing' && (
          <p role="status" className="system-sm-regular text-text-secondary">
            {t(($) => $['archives.downloadHint.preparing'], { ns: 'appLog' })}
          </p>
        )}
        {status === 'failed' && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {t(($) => $['export.failed'], { ns: 'appLog' })}
          </p>
        )}
        {status === 'canceled' && (
          <p role="status" className="system-sm-regular text-text-secondary">
            {t(($) => $['export.canceled'], { ns: 'appLog' })}
          </p>
        )}
      </div>
      {status === 'ready' && (
        <Button
          type="button"
          size="small"
          variant="secondary"
          className="shrink-0"
          onClick={() => downloadUrl({ url: fileUrl })}
        >
          {t(($) => $['operation.download'], { ns: 'common' })}
        </Button>
      )}
      {onViewProgress && (
        <Button
          type="button"
          size="small"
          variant="secondary"
          className="shrink-0"
          onClick={onViewProgress}
        >
          {t(($) => $['export.viewProgress'], { ns: 'appLog' })}
        </Button>
      )}
    </div>
  )
}

type LogExportDialogProps = {
  appName: string
  planState: CloudSandboxPlanState
  timezone: string
  open: boolean
  onOpenChange: (open: boolean) => void
  phase: LogExportPhase
  submitting: boolean
  createFailed: boolean
  pendingPreview: boolean
  counts?: { rows: number; logs?: number; conversations?: number }
  previewDescription: string
  lastExport?: LastLogExportProps | null
  progress?: Omit<ComponentProps<typeof LogExportProgressDialog>, 'appName' | 'finalFocus'>
  onExport: () => void
  onRetryStatus: () => void
  children: ReactNode
}

export function LogExportDialog({
  appName,
  planState,
  timezone,
  open,
  onOpenChange,
  phase,
  submitting,
  createFailed,
  pendingPreview,
  counts,
  previewDescription,
  lastExport,
  progress,
  onExport,
  onRetryStatus,
  children,
}: LogExportDialogProps) {
  const { t } = useTranslation(['appLog', 'common'])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const busy = phase === 'checking' || phase === 'exporting'
  const retryStatus = phase === 'retry-status'
  const taskInProgress = lastExport?.status === 'pending' || lastExport?.status === 'processing'
  const noMatches = !pendingPreview && counts?.rows === 0
  const canExport = phase === 'selecting' && !pendingPreview && !noMatches
  const title = t(($) => $['export.title'], { ns: 'appLog' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const cancelLabel = t(($) => $['operation.cancel'], { ns: 'common' })

  let actionLabel: string = t(($) => $['export.submit'], { ns: 'appLog' })
  if (phase === 'exporting') actionLabel = t(($) => $['operation.exporting'], { ns: 'common' })
  else if (retryStatus) actionLabel = t(($) => $['operation.retry'], { ns: 'common' })

  const showDescription = phase === 'selecting' && !noMatches && (pendingPreview || counts)
  const countSummary =
    counts &&
    [
      counts.logs != null &&
        t(($) => $['export.previewLogCount'], { ns: 'appLog', count: counts.logs }),
      counts.conversations != null &&
        t(($) => $['export.previewConversationCount'], {
          ns: 'appLog',
          count: counts.conversations,
        }),
      t(($) => $['export.previewRowCount'], { ns: 'appLog', count: counts.rows }),
    ]
      .filter(Boolean)
      .join(' · ')

  let summary
  if (phase === 'exporting') summary = actionLabel
  else if (phase === 'checking' || pendingPreview)
    summary = `${t(($) => $['detail.loading'], { ns: 'appLog' })}…`
  else summary = countSummary ?? t(($) => $['export.previewUnavailable'], { ns: 'appLog' })

  let error
  if (retryStatus) error = t(($) => $['export.statusFailed'], { ns: 'appLog' })
  else if (createFailed) error = t(($) => $['export.failed'], { ns: 'appLog' })
  else if (noMatches && phase === 'selecting')
    error = t(($) => $['export.noMatches'], { ns: 'appLog' })

  if (planState === 'pending') return null

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && submitting) return
          onOpenChange(next)
        }}
      >
        <DialogTrigger ref={triggerRef} render={<Button variant="secondary" />}>
          <span className="i-ri-download-2-line size-4" aria-hidden />
          {title}
        </DialogTrigger>
        <DialogContent finalFocus={progress?.open ? false : undefined}>
          <DialogHeader>
            <DialogTitle>
              {planState === 'sandbox'
                ? t(($) => $['export.upgradeTitle'], { ns: 'appLog' })
                : title}
            </DialogTitle>
            <DialogDescription>
              {planState === 'sandbox'
                ? t(($) => $['export.upgradeDescription'], { ns: 'appLog' })
                : appName}
            </DialogDescription>
            <DialogHeaderCloseButton aria-label={closeLabel} disabled={submitting} />
          </DialogHeader>
          {planState === 'sandbox' ? (
            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>{cancelLabel}</DialogClose>
              <UpgradeBtn isShort className="shrink-0" loc="logs-export" />
            </DialogFooter>
          ) : (
            <form
              className="contents"
              onSubmit={(event) => {
                event.preventDefault()
                if (retryStatus) onRetryStatus()
                else if (canExport) onExport()
              }}
            >
              <DialogBody className="space-y-4">
                <fieldset disabled={phase !== 'selecting'} className="min-w-0 space-y-4">
                  {children}
                </fieldset>
                {!taskInProgress && !retryStatus && (
                  <div className="grid rounded-lg bg-background-section-burn px-3 py-2.5 system-sm-regular text-text-secondary">
                    {pendingPreview && countSummary && showDescription && (
                      <p aria-hidden className="invisible col-start-1 row-start-1">
                        {countSummary} {previewDescription}
                      </p>
                    )}
                    <p className="col-start-1 row-start-1">
                      <span role="status">{summary}</span>
                      {showDescription && (
                        <>
                          {' '}
                          <span>{previewDescription}</span>
                        </>
                      )}
                    </p>
                  </div>
                )}
                {error && (
                  <p role="alert" className="system-sm-regular text-text-destructive">
                    {error}
                  </p>
                )}
                {lastExport && phase !== 'checking' && (
                  <LastLogExport {...lastExport} timezone={timezone} />
                )}
              </DialogBody>
              <DialogFooter>
                <DialogClose
                  disabled={submitting}
                  render={<Button type="button" variant="secondary" />}
                >
                  {busy ? closeLabel : cancelLabel}
                </DialogClose>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!retryStatus && !canExport}
                  loading={busy}
                >
                  {actionLabel}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {progress && (
        <LogExportProgressDialog {...progress} appName={appName} finalFocus={triggerRef} />
      )}
    </>
  )
}
