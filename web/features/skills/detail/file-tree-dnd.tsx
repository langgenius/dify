'use client'

import type { SkillUploadQueueItem } from './shared'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export type SkillDropOperation = 'move' | 'upload'

export type SkillDropTarget = {
  operation: SkillDropOperation
  path: string
}

export function SkillDropDestinationHint({ target }: { target: SkillDropTarget | undefined }) {
  if (!target) return null

  const destination = target.path || 'root folder'
  const action = target.operation === 'upload' ? 'Upload' : 'Move'
  const label = `${action} to ${destination}`
  return (
    <div className="pointer-events-none absolute inset-x-1 bottom-2 z-10 flex justify-center">
      <div className="flex h-7 max-w-full items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]">
        <span
          aria-label={label}
          className="max-w-full truncate px-0.5 system-xs-regular text-text-secondary"
        >
          {action} to <strong className="font-medium">{destination}</strong>
        </span>
      </div>
    </div>
  )
}

export function SkillUploadStatusPanel({
  items,
  onCancel,
  onDismiss,
  onViewErrors,
}: {
  items: SkillUploadQueueItem[]
  onCancel: () => void
  onDismiss: () => void
  onViewErrors: () => void
}) {
  const { t } = useTranslation('skill')
  const { t: tCommon } = useTranslation('common')
  if (items.length === 0) return null

  const uploadedCount = items.filter((item) => item.status === 'uploaded').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const completedCount = uploadedCount + failedCount
  const hasActiveUpload = items.some(
    (item) => item.status === 'uploading' || item.status === 'saving',
  )
  const averageProgress =
    items.reduce((sum, item) => {
      if (item.status === 'uploaded' || item.status === 'failed') return sum + 100
      return sum + item.progress
    }, 0) / items.length

  return (
    <div className="pointer-events-none absolute inset-x-1 bottom-2 z-10">
      <div
        className={cn(
          'pointer-events-auto relative overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]',
          failedCount > 0 && !hasActiveUpload
            ? 'min-h-[72px] px-2 py-2'
            : 'flex h-8 items-center gap-2 py-1 pr-1.5 pl-2',
          !hasActiveUpload &&
            (failedCount > 0
              ? 'before:absolute before:inset-0 before:bg-gradient-to-r before:from-state-warning-hover before:to-transparent before:opacity-40'
              : 'before:absolute before:inset-0 before:bg-gradient-to-r before:from-state-success-hover before:to-transparent before:opacity-40'),
        )}
      >
        {hasActiveUpload && (
          <div
            className="absolute inset-y-0 left-0 border-r-[1.5px] border-state-accent-solid/20 bg-state-accent-hover transition-[width]"
            style={{ width: `${averageProgress}%` }}
          />
        )}
        <div
          className={cn(
            'relative flex min-w-0 flex-1',
            failedCount > 0 && !hasActiveUpload ? 'items-start gap-2' : 'items-center gap-2',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'relative size-4 shrink-0',
              hasActiveUpload
                ? 'i-ri-upload-cloud-2-line text-text-accent'
                : failedCount > 0
                  ? 'i-ri-error-warning-fill text-text-warning-secondary'
                  : 'i-ri-checkbox-circle-fill text-text-success',
            )}
          />
          {failedCount > 0 && !hasActiveUpload ? (
            <div className="min-w-0 flex-1">
              <div
                className="truncate system-xs-semibold text-text-primary"
                title={t(($) => $['skillManagement.detail.uploadFailureTitle'])}
              >
                {t(($) => $['skillManagement.detail.uploadFailureTitle'])}
              </div>
              <div className="mt-1 border-l border-divider-subtle pl-2 system-xs-regular text-text-tertiary">
                {t(($) => $['skillManagement.detail.uploadFailureSummary'], {
                  failed: failedCount,
                  total: items.length,
                })}
                <button
                  type="button"
                  className="block cursor-pointer text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={onViewErrors}
                >
                  {t(($) => $['skillManagement.detail.viewUploadErrors'])}
                </button>
              </div>
            </div>
          ) : (
            <span
              className="min-w-0 flex-1 truncate system-xs-semibold text-text-primary"
              title={
                hasActiveUpload
                  ? t(($) => $['skillManagement.detail.uploadFilesProgress'], {
                      completed: completedCount,
                      total: items.length,
                    })
                  : `${uploadedCount} ${uploadedCount === 1 ? 'file' : 'files'} uploaded`
              }
            >
              {hasActiveUpload
                ? t(($) => $['skillManagement.detail.uploadFilesProgress'], {
                    completed: completedCount,
                    total: items.length,
                  })
                : `${uploadedCount} ${uploadedCount === 1 ? 'file' : 'files'} uploaded`}
            </span>
          )}
        </div>
        {hasActiveUpload ? (
          <button
            type="button"
            className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md p-0.5 text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            aria-label={tCommon(($) => $['operation.cancel'])}
            onClick={onCancel}
          >
            <span aria-hidden className="i-ri-stop-circle-line size-[18px]" />
          </button>
        ) : (
          <div className="relative flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={cn(
                'flex size-6 cursor-pointer items-center justify-center rounded-md p-0.5 text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                failedCount > 0 && 'absolute top-1 right-1',
              )}
              aria-label={t(($) => $['skillManagement.detail.uploadStatusDismiss'])}
              onClick={onDismiss}
            >
              <span aria-hidden className="i-ri-close-line size-[18px]" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
