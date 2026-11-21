'use client'

import type { KnowledgeFsUploadPhase } from './knowledge-fs-upload'
import type { DocumentUploadIssue } from './policy'
import type { FileScanFailure } from '@/features/file-scan/scan-failure'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fileScanFailureMessage } from '@/features/file-scan/scan-failure'
import { LocalFilePreview } from './local-file-preview'
import { canPreviewLocalFile } from './local-file-preview-policy'
import { documentUploadFileExtension, documentUploadIssue } from './policy'

export type DocumentUploadFileItem = {
  file: File
  id: string
  issue?: DocumentUploadIssue
}

function formatFileSize(bytes: number, locale: string) {
  const [value, unit, maximumFractionDigits]: [number, Intl.NumberFormatOptions['unit'], number] =
    bytes < 1024
      ? [bytes, 'byte', 0]
      : bytes < 1024 * 1024
        ? [Math.ceil(bytes / 1024), 'kilobyte', 0]
        : [bytes / (1024 * 1024), 'megabyte', 1]
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
    style: 'unit',
    unit,
    unitDisplay: 'short',
  }).format(value)
}

function fileIconClass(extension: string) {
  if (extension === 'PDF') return 'i-ri-file-pdf-2-fill text-text-destructive'
  if (extension === 'DOC' || extension === 'DOCX') return 'i-ri-file-word-2-fill text-text-accent'
  if (extension === 'XLS' || extension === 'XLSX') return 'i-ri-file-excel-fill text-text-success'
  return 'i-ri-file-text-fill text-text-tertiary'
}

export function DocumentUploadFileList({
  ariaLabel,
  className,
  disabled,
  fileSizeLimitMb,
  items,
  onRemove,
  onRetry,
  uploadFailures = new Map(),
  uploadProgress = new Map(),
  variant = 'form',
}: {
  ariaLabel?: string
  className?: string
  disabled: boolean
  fileSizeLimitMb: number
  items: DocumentUploadFileItem[]
  onRemove: (item: DocumentUploadFileItem) => void
  /** Claims a file again after a retryable malware-scan rejection. */
  onRetry?: (item: DocumentUploadFileItem) => void
  /** Malware-scan rejections of the last upload attempt, keyed like `uploadProgress`. */
  uploadFailures?: ReadonlyMap<File, FileScanFailure>
  uploadProgress?: ReadonlyMap<File, KnowledgeFsUploadPhase>
  variant?: 'compact' | 'form'
}) {
  const { i18n, t } = useTranslation(['knowledgeSpace', 'knowledgeCreate'])
  const { t: tCommon } = useTranslation(['common'])
  const { t: tFileScan } = useTranslation(['fileScan'])
  const [previewFile, setPreviewFile] = useState<File>()
  const [previewOpen, setPreviewOpen] = useState(false)

  return (
    <>
      <ul className={cn('space-y-1', className)} aria-label={ariaLabel}>
        {items.map((item) => {
          const issue = item.issue ?? documentUploadIssue(item.file, fileSizeLimitMb)
          const fileExtension = documentUploadFileExtension(item.file.name)
          const extension = fileExtension ? fileExtension.toUpperCase() : t(($) => $.documentColumn)
          const phase = uploadProgress.get(item.file)
          const fileUploading = phase === 'pending' || phase === 'scanning'
          const scanFailure = fileUploading ? undefined : uploadFailures.get(item.file)
          const status = fileUploading
            ? phase === 'scanning'
              ? tFileScan(($) => $['upload.scanning'])
              : t(($) => $.uploadingFiles, { ns: 'knowledgeCreate' })
            : phase === 'completed'
              ? t(($) => $.uploadCompleted, { ns: 'knowledgeCreate' })
              : issue
                ? issue === 'fileSize'
                  ? t(($) => $['documentUploadExclusion.fileSize'], {
                      size: fileSizeLimitMb,
                    })
                  : t(($) => $[`documentUploadExclusion.${issue}`])
                : undefined
          return (
            <li
              key={item.id}
              aria-busy={fileUploading || undefined}
              className={cn(
                'group overflow-hidden rounded-lg border-[0.5px] shadow-xs',
                issue || scanFailure
                  ? 'border-state-destructive-border bg-state-destructive-hover'
                  : 'border-components-panel-border bg-components-panel-on-panel-item-bg',
              )}
            >
              <div className="flex h-12 min-w-0 items-center">
                <span className="flex shrink-0 items-start p-3">
                  <span aria-hidden className={cn('size-6', fileIconClass(extension))} />
                </span>
                <span className="min-w-0 flex-1 py-1 pe-2 text-start">
                  <span className="block truncate system-xs-medium text-text-primary">
                    {item.file.name}
                  </span>
                  <span className="mt-0.5 flex min-h-3 items-center gap-1 system-2xs-medium text-text-tertiary">
                    {extension} · {formatFileSize(item.file.size, i18n.language)}
                    {Boolean(status) && (
                      <>
                        <span aria-hidden className="text-text-quaternary">
                          ·
                        </span>
                        <span
                          className={cn(
                            'truncate',
                            issue ? 'text-text-destructive' : 'text-text-tertiary',
                          )}
                        >
                          {status}
                        </span>
                      </>
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 py-2 pe-3">
                  {fileUploading ? (
                    <span className="flex size-6 items-center justify-center">
                      <span
                        aria-hidden
                        className={cn(
                          'i-ri-loader-2-line animate-spin text-text-accent motion-reduce:animate-none',
                          variant === 'compact' ? 'size-3' : 'size-4',
                        )}
                      />
                    </span>
                  ) : (
                    !issue &&
                    !scanFailure &&
                    canPreviewLocalFile(item.file) && (
                      <Button
                        className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                        size="small"
                        type="button"
                        onClick={() => {
                          setPreviewFile(item.file)
                          setPreviewOpen(true)
                        }}
                      >
                        {t(($) => $.preview)}
                      </Button>
                    )
                  )}
                  {(issue || scanFailure) && (
                    <span className="flex size-6 items-center justify-center">
                      <span
                        aria-hidden
                        className="i-ri-error-warning-fill size-4 text-text-destructive"
                      />
                    </span>
                  )}
                  <button
                    aria-label={`${tCommon(($) => $['operation.remove'])}${
                      variant === 'compact' ? ' ' : ' · '
                    }${item.file.name}`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
                    disabled={disabled}
                    type="button"
                    onClick={() => onRemove(item)}
                  >
                    <span
                      aria-hidden
                      className={
                        variant === 'compact'
                          ? 'i-ri-close-line size-4'
                          : 'i-ri-delete-bin-line size-4'
                      }
                    />
                  </button>
                </span>
              </div>
              {scanFailure && (
                <div className="flex items-start gap-2 px-3 pb-2">
                  <p className="min-w-0 flex-1 system-xs-regular wrap-break-word text-text-destructive">
                    {fileScanFailureMessage(tFileScan, scanFailure)}
                  </p>
                  {scanFailure.retryable && onRetry && (
                    <Button
                      aria-label={tFileScan(($) => $['upload.retryFile'], {
                        file: item.file.name,
                      })}
                      className="shrink-0"
                      disabled={disabled}
                      size="small"
                      type="button"
                      onClick={() => onRetry(item)}
                    >
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <LocalFilePreview file={previewFile} open={previewOpen} onOpenChange={setPreviewOpen} />
    </>
  )
}
