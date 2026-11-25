import type { ConversationLogExportStatusResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
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
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { downloadUrl } from '@/utils/download'

export function LogExportProgressDialog({
  appName,
  open,
  task,
  statusError,
  fileUrl,
  finalFocus,
  onClose,
  onRetry,
}: {
  appName: string
  open: boolean
  task?: ConversationLogExportStatusResponse
  statusError: boolean
  fileUrl: string
  finalFocus: ComponentProps<typeof DialogContent>['finalFocus']
  onClose: () => void
  onRetry: () => void
}) {
  const { t, i18n } = useTranslation(['appLog', 'common'])
  const title = t(($) => $['export.progressTitle'], { ns: 'appLog' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const ready = !statusError && task?.status === 'ready'
  const failed = !statusError && task?.status === 'failed'
  const active = !statusError && !ready && !failed
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
        </DialogBody>
        <DialogFooter>
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
