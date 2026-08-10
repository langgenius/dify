'use client'

import type { KnowledgeFsUploadPhase } from './knowledge-fs-upload'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DOCUMENT_UPLOAD_ACCEPT,
  documentUploadFileExtension,
  documentUploadIssue,
} from './document-upload-policy'
import { canPreviewLocalFile, openLocalFilePreview } from './local-file-preview'
import { createRequestId } from './request-id'

export type QueuedUpload = {
  file: File
  id: string
  issue?: 'fileSize' | 'fileType'
}

function createQueuedUpload(file: File): QueuedUpload {
  return {
    file,
    id: createRequestId(),
    issue: documentUploadIssue(file),
  }
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

function mergeFiles(current: QueuedUpload[], files: File[]) {
  const fingerprints = new Set(
    current.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`),
  )
  return [
    ...current,
    ...files.flatMap((file) => {
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}`
      if (fingerprints.has(fingerprint)) return []
      fingerprints.add(fingerprint)
      return [createQueuedUpload(file)]
    }),
  ]
}

export function CreateUploadQueue({
  disabled,
  uploadPhases = new Map(),
  uploading,
  uploads,
  onChange,
}: {
  disabled: boolean
  uploadPhases?: ReadonlyMap<File, KnowledgeFsUploadPhase>
  uploading: boolean
  uploads: QueuedUpload[]
  onChange: (uploads: QueuedUpload[]) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const inputId = useId()
  const [dragging, setDragging] = useState(false)

  const addFiles = (files: File[]) => {
    if (!disabled && files.length) onChange(mergeFiles(uploads, files))
  }

  return (
    <div className="mx-[14.5px] -mt-[3.5px] mb-[14.5px] space-y-3">
      <input
        id={inputId}
        className="peer sr-only"
        multiple
        type="file"
        accept={DOCUMENT_UPLOAD_ACCEPT}
        aria-label={t(($) => $['newKnowledge.uploadFiles'])}
        disabled={disabled}
        onChange={(event) => {
          addFiles([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ''
        }}
      />
      <label
        htmlFor={inputId}
        className={cn(
          'flex h-16 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-divider-regular bg-background-section px-4 text-center outline-hidden transition-colors motion-reduce:transition-none',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-state-accent-solid',
          disabled
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer hover:border-components-option-card-option-selected-border hover:bg-state-base-hover has-focus-visible:ring-2 has-focus-visible:ring-state-accent-solid',
          dragging && 'border-components-option-card-option-selected-border bg-state-base-hover',
        )}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles([...event.dataTransfer.files])
        }}
      >
        <span className="flex items-center gap-1.5 system-xs-medium text-text-primary">
          <span
            aria-hidden
            className={cn(
              'size-5 text-text-tertiary',
              uploading
                ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
                : 'i-ri-upload-cloud-2-line',
            )}
          />
          {uploading
            ? t(($) => $['newKnowledge.uploadingFiles'])
            : t(($) => $['newKnowledge.uploadDropZoneTitle'])}
        </span>
        <span className="system-2xs-medium text-text-tertiary">
          {t(($) => $['newKnowledge.documentUploadFormats'])}
        </span>
      </label>

      {!!uploads.length && (
        <ul className="space-y-1" aria-label={t(($) => $['newKnowledge.uploadFiles'])}>
          {uploads.map((upload) => {
            const extension =
              documentUploadFileExtension(upload.file.name).toLocaleUpperCase() || 'FILE'
            const fileUploading = uploadPhases.get(upload.file) === 'pending'
            return (
              <li
                key={upload.id}
                aria-busy={fileUploading || undefined}
                className={cn(
                  'group flex h-12 min-w-0 items-center overflow-hidden rounded-lg border-[0.5px] shadow-xs',
                  upload.issue
                    ? 'border-state-destructive-border bg-state-destructive-hover'
                    : 'border-components-panel-border bg-components-panel-on-panel-item-bg',
                )}
              >
                <span className="flex shrink-0 items-start p-3">
                  <span aria-hidden className={cn('size-6', fileIconClass(extension))} />
                </span>
                <span className="min-w-0 flex-1 py-1 pr-2 text-left">
                  <span className="block truncate system-xs-medium text-text-primary">
                    {upload.file.name}
                  </span>
                  <span className="mt-0.5 flex min-h-3 items-center gap-1 system-2xs-medium text-text-tertiary">
                    {extension} · {formatFileSize(upload.file.size)}
                    <span aria-hidden className="text-text-quaternary">
                      ·
                    </span>
                    <span
                      className={cn(
                        'truncate',
                        upload.issue ? 'text-text-destructive' : 'text-text-tertiary',
                      )}
                    >
                      {fileUploading
                        ? t(($) => $['newKnowledge.uploadingFiles'])
                        : upload.issue === 'fileSize'
                          ? t(($) => $['newKnowledge.documentUploadExclusion.fileSize'])
                          : upload.issue === 'fileType'
                            ? t(($) => $['newKnowledge.documentUploadExclusion.fileType'])
                            : t(($) => $['newKnowledge.uploadCharactersUnavailable'])}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 py-2 pr-3">
                  {fileUploading ? (
                    <span className="flex size-6 items-center justify-center">
                      <span
                        aria-hidden
                        className="i-ri-loader-2-line size-3 animate-spin text-text-accent motion-reduce:animate-none"
                      />
                    </span>
                  ) : (
                    !upload.issue &&
                    canPreviewLocalFile(upload.file) && (
                      <Button
                        size="small"
                        className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                        onClick={() => openLocalFilePreview(upload.file)}
                      >
                        {t(($) => $['newKnowledge.preview'])}
                      </Button>
                    )
                  )}
                  {upload.issue && (
                    <span className="flex size-6 items-center justify-center">
                      <span
                        aria-hidden
                        className="i-ri-error-warning-fill size-4 text-text-destructive"
                      />
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${tCommon(($) => $['operation.remove'])} ${upload.file.name}`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
                    onClick={() =>
                      onChange(uploads.filter((candidate) => candidate.id !== upload.id))
                    }
                  >
                    <span aria-hidden className="i-ri-close-line size-4" />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
