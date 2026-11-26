import type { ConversationLogExportStatusResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import type { LogExportCancellation, LogExportEmailNotification } from './use-log-export'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
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
} from '@langgenius/dify-ui/dialog'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadUrl } from '@/utils/download'
import { useObserveLogExportProgress } from './notification-visibility'

export function LogExportProgressDialog({
  appName,
  open,
  taskId,
  task,
  statusError,
  cancellation,
  emailNotification,
  fileUrl,
  finalFocus,
  onClose,
  onRetry,
}: {
  appName: string
  open: boolean
  taskId: string
  task?: ConversationLogExportStatusResponse
  statusError: boolean
  cancellation?: LogExportCancellation
  emailNotification?: LogExportEmailNotification
  fileUrl: string
  finalFocus: ComponentProps<typeof DialogContent>['finalFocus']
  onClose: () => void
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation(['appLog', 'common'])
  const emailLabelId = useId()
  const title = t(($) => $['export.progressTitle'], { ns: 'appLog' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const ready = !statusError && task?.status === 'ready'
  useObserveLogExportProgress(open ? taskId : null, ready && task.task_id === taskId)
  const failed = !statusError && task?.status === 'failed'
  const canceled = !statusError && task?.status === 'canceled'
  const active = !statusError && !ready && !failed && !canceled
  const emailQueued = emailNotification?.state === 'queued'
  const progress = task?.progress
  const written = progress?.rows_written ?? 0
  const estimate = task?.estimated_rows
  const hasEstimate = estimate != null && estimate > 0
  const uploading = progress?.stage === 'uploading'
  const locale = i18n.resolvedLanguage ?? i18n.language

  let percentage: number | undefined
  if (ready) percentage = 100
  else if (hasEstimate)
    percentage = uploading ? 99 : Math.min(99, Math.floor((written / estimate) * 100))

  let rows
  if (active && hasEstimate && !uploading)
    rows = t(($) => $['export.progressEstimatedRows'], {
      ns: 'appLog',
      written: written.toLocaleString(locale),
      total: estimate.toLocaleString(locale),
    })
  else if (progress && (ready || (active && (uploading || progress.stage === 'writing'))))
    rows = t(($) => $['export.progressRows'], { ns: 'appLog', count: written })

  let status: string = t(($) => $['export.progressPreparing'], { ns: 'appLog' })
  if (statusError) status = t(($) => $['export.statusFailed'], { ns: 'appLog' })
  else if (failed) status = t(($) => $['export.failed'], { ns: 'appLog' })
  else if (canceled) status = t(($) => $['export.canceled'], { ns: 'appLog' })
  else if (ready) status = t(($) => $['export.progressReady'], { ns: 'appLog' })
  else if (task?.status === 'pending')
    status = t(($) => $['export.progressQueued'], { ns: 'appLog' })
  else if (uploading) status = t(($) => $['export.progressUploading'], { ns: 'appLog' })
  else if (progress?.stage === 'writing')
    status = t(($) => $['export.progressWriting'], { ns: 'appLog' })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{appName}</DialogDescription>
          <DialogHeaderCloseButton aria-label={closeLabel} />
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 system-sm-medium">
              <p
                role={failed || statusError ? 'alert' : 'status'}
                className={failed || statusError ? 'text-text-destructive' : 'text-text-primary'}
              >
                {status}
              </p>
              {(active || ready) && percentage !== undefined && (
                <span aria-hidden className="text-text-secondary tabular-nums">
                  {(percentage / 100).toLocaleString(locale, { style: 'percent' })}
                </span>
              )}
            </div>
            {(active || ready) && (
              <div
                role="progressbar"
                aria-label={title}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                className="h-2 w-full overflow-hidden rounded-full bg-divider-deep"
              >
                {percentage === undefined ? (
                  <div
                    aria-hidden
                    className="size-full bg-components-button-primary-bg/30 motion-safe:animate-pulse"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-full rounded-full bg-components-button-primary-bg motion-safe:transition-[inline-size]"
                    style={{ inlineSize: `${percentage}%` }}
                  />
                )}
              </div>
            )}
            {rows && <p className="system-sm-regular text-text-secondary">{rows}</p>}
          </div>
          {active && (
            <div className="space-y-1 system-sm-regular text-text-secondary">
              <p>{t(($) => $['export.progressBackground'], { ns: 'appLog' })}</p>
              <p>{t(($) => $['export.progressDownloadLater'], { ns: 'appLog' })}</p>
            </div>
          )}
          {cancellation?.failed && (
            <p role="alert" className="system-sm-regular text-text-destructive">
              {t(($) => $['export.cancelFailed'], { ns: 'appLog' })}
            </p>
          )}
          {emailNotification && (active || (ready && emailQueued)) && (
            <div className="space-y-1 system-sm-regular text-text-secondary">
              {active && (
                <label className="flex items-center gap-2">
                  <Checkbox
                    aria-labelledby={emailLabelId}
                    checked={emailNotification.state !== 'off'}
                    disabled={emailNotification.pending || emailNotification.state === 'queued'}
                    onCheckedChange={emailNotification.onChange}
                  />
                  <span id={emailLabelId}>
                    {t(($) => $['export.emailNotifyWhenFinished'], { ns: 'appLog' })}
                  </span>
                </label>
              )}
              {emailQueued && (
                <p role="status">{t(($) => $['export.emailQueued'], { ns: 'appLog' })}</p>
              )}
              {active && emailNotification.updateFailed && (
                <p role="alert" className="text-text-destructive">
                  {t(($) => $['export.emailUpdateFailed'], { ns: 'appLog' })}
                </p>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          {cancellation && (
            <Button
              type="button"
              variant="secondary"
              loading={cancellation.pending}
              onClick={cancellation.onCancel}
            >
              {t(($) => $['export.cancel'], { ns: 'appLog' })}
            </Button>
          )}
          <DialogClose
            render={
              <Button type="button" variant={ready || statusError ? 'secondary' : 'primary'} />
            }
          >
            {closeLabel}
          </DialogClose>
          {statusError && (
            <Button type="button" variant="primary" onClick={onRetry}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          )}
          {ready && (
            <Button type="button" variant="primary" onClick={() => downloadUrl({ url: fileUrl })}>
              {t(($) => $['operation.download'], { ns: 'common' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
