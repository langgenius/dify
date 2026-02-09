'use client'

import type { ReactNode } from 'react'
import {
  RiAlertFill,
  RiCheckboxCircleFill,
  RiCloseLine,
  RiUploadCloud2Line,
} from '@remixicon/react'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'

type UploadStatusTooltipProps = {
  fallback?: ReactNode
}

const SUCCESS_DISPLAY_MS = 2000

const UploadStatusTooltip = ({ fallback }: UploadStatusTooltipProps) => {
  const { t } = useTranslation('workflow')
  const storeApi = useWorkflowStore()
  const uploadStatus = useStore(s => s.uploadStatus)
  const uploadProgress = useStore(s => s.uploadProgress)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current)
      clearTimeout(timerRef.current)

    if (uploadStatus === 'success') {
      timerRef.current = setTimeout(() => {
        storeApi.getState().resetUpload()
      }, SUCCESS_DISPLAY_MS)
    }

    return () => {
      if (timerRef.current)
        clearTimeout(timerRef.current)
    }
  }, [storeApi, uploadStatus])

  if (uploadStatus === 'idle')
    return <>{fallback}</>

  const handleClose = () => {
    storeApi.getState().resetUpload()
  }

  return (
    <div className="flex shrink-0 items-center justify-center px-2 py-3">
      <div
        className={cn(
          'relative flex w-full items-center gap-2 overflow-hidden rounded-lg py-1.5 pl-3 pr-2.5 shadow-lg backdrop-blur-[5px]',
          'border-[0.5px] border-components-panel-border bg-components-tooltip-bg',
        )}
      >
        {uploadStatus === 'uploading' && (
          <>
            <div className="absolute inset-[-0.5px] bg-components-progress-bar-bg" />
            <div
              className="absolute bottom-[-0.5px] left-[-0.5px] top-[-0.5px] border-r-[1.5px] border-components-progress-bar-progress-highlight bg-components-progress-bar-progress"
              style={{ width: uploadProgress.total > 0 ? `${(uploadProgress.uploaded / uploadProgress.total) * 100}%` : '0%' }}
            />
          </>
        )}
        {uploadStatus === 'success' && (
          <div className="absolute inset-[-0.5px] bg-toast-success-bg opacity-40" />
        )}
        {uploadStatus === 'partial_error' && (
          <div className="absolute inset-[-0.5px] bg-state-warning-hover opacity-40" />
        )}

        <div className="relative z-10 shrink-0">
          {uploadStatus === 'uploading' && (
            <RiUploadCloud2Line className="size-6 text-text-accent" />
          )}
          {uploadStatus === 'success' && (
            <RiCheckboxCircleFill className="size-5 text-text-success" />
          )}
          {uploadStatus === 'partial_error' && (
            <RiAlertFill className="size-5 text-text-warning" />
          )}
        </div>

        <div className="relative z-10 flex min-w-0 flex-1 flex-col">
          <span className="truncate text-text-primary system-xs-semibold">
            {uploadStatus === 'uploading' && t('skillSidebar.uploadingItems', {
              uploaded: uploadProgress.uploaded,
              total: uploadProgress.total,
            })}
            {uploadStatus === 'success' && t('skillSidebar.uploadSuccess')}
            {uploadStatus === 'partial_error' && t('skillSidebar.uploadPartialError')}
          </span>
          <span className="truncate text-text-tertiary system-2xs-regular">
            {uploadStatus === 'success' && t('skillSidebar.uploadSuccessDetail', {
              uploaded: uploadProgress.uploaded,
              total: uploadProgress.total,
            })}
            {uploadStatus === 'partial_error' && t('skillSidebar.uploadPartialErrorDetail', {
              failed: uploadProgress.failed,
              total: uploadProgress.total,
            })}
            {uploadStatus === 'uploading' && (
              <span className="inline-flex gap-px">
                <span className="animate-pulse">·</span>
                <span className="animate-pulse" style={{ animationDelay: '0.3s' }}>·</span>
                <span className="animate-pulse" style={{ animationDelay: '0.6s' }}>·</span>
              </span>
            )}
          </span>
        </div>

        <button
          type="button"
          aria-label={t('operation.close', { ns: 'common' })}
          className="relative z-10 shrink-0 rounded p-0.5 text-text-tertiary hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-state-accent-solid"
          onClick={handleClose}
        >
          <RiCloseLine className="size-4" />
        </button>
      </div>
    </div>
  )
}

export default memo(UploadStatusTooltip)
