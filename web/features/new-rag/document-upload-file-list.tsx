'use client'

import type { ReactNode } from 'react'
import type { DocumentUploadIssue } from './document-upload-policy'
import type { KnowledgeFsUploadPhase } from './knowledge-fs-upload'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { documentUploadFileExtension, documentUploadIssue } from './document-upload-policy'
import { LocalFilePreview } from './local-file-preview'
import { canPreviewLocalFile } from './local-file-preview-policy'

export type DocumentUploadFileItem = {
  file: File
  id: string
  issue?: DocumentUploadIssue
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  idleStatus,
  items,
  onRemove,
  uploadProgress = new Map(),
  variant = 'form',
}: {
  ariaLabel?: string
  className?: string
  disabled: boolean
  idleStatus?: ReactNode
  items: DocumentUploadFileItem[]
  onRemove: (item: DocumentUploadFileItem) => void
  uploadProgress?: ReadonlyMap<File, KnowledgeFsUploadPhase>
  variant?: 'compact' | 'form'
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const [previewFile, setPreviewFile] = useState<File>()

  return (
    <>
      <ul className={cn('space-y-1', className)} aria-label={ariaLabel}>
        {items.map((item) => {
          const issue = item.issue ?? documentUploadIssue(item.file)
          const extension =
            documentUploadFileExtension(item.file.name).toLocaleUpperCase() || 'FILE'
          const fileUploading = uploadProgress.get(item.file) === 'pending'
          const status = fileUploading
            ? t(($) => $['newKnowledge.uploadingFiles'])
            : issue
              ? t(($) => $[`newKnowledge.documentUploadExclusion.${issue}`])
              : idleStatus
          return (
            <li
              key={item.id}
              aria-busy={fileUploading || undefined}
              className={cn(
                'group flex h-12 min-w-0 items-center overflow-hidden rounded-lg border-[0.5px] shadow-xs',
                issue
                  ? 'border-state-destructive-border bg-state-destructive-hover'
                  : 'border-components-panel-border bg-components-panel-on-panel-item-bg',
              )}
            >
              <span className="flex shrink-0 items-start p-3">
                <span aria-hidden className={cn('size-6', fileIconClass(extension))} />
              </span>
              <span className="min-w-0 flex-1 py-1 pr-2 text-left">
                <span className="block truncate system-xs-medium text-text-primary">
                  {item.file.name}
                </span>
                <span className="mt-0.5 flex min-h-3 items-center gap-1 system-2xs-medium text-text-tertiary">
                  {extension} · {formatFileSize(item.file.size)}
                  {status && (
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
              <span className="flex shrink-0 items-center gap-1 py-2 pr-3">
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
                  canPreviewLocalFile(item.file) && (
                    <Button
                      className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                      size="small"
                      type="button"
                      onClick={() => setPreviewFile(item.file)}
                    >
                      {t(($) => $['newKnowledge.preview'])}
                    </Button>
                  )
                )}
                {issue && (
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
            </li>
          )
        })}
      </ul>
      {previewFile && (
        <LocalFilePreview file={previewFile} onClose={() => setPreviewFile(undefined)} />
      )}
    </>
  )
}
