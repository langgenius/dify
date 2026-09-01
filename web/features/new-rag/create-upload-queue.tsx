'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DOCUMENT_UPLOAD_ACCEPT,
  documentUploadFileExtension,
  documentUploadIssue,
} from './document-upload-policy'
import { createRequestId } from './request-id'

const PREVIEWABLE_EXTENSIONS = new Set(['doc', 'docx', 'html', 'markdown', 'md', 'pdf', 'txt'])

export type QueuedUpload = {
  file: File
  id: string
  issue?: 'fileSize' | 'fileType'
}

function createQueuedUpload(file: File): QueuedUpload {
  return {
    file,
    id: `${file.name}:${file.size}:${file.lastModified}:${createRequestId()}`,
    issue: documentUploadIssue(file),
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileBadge(file: File) {
  return documentUploadFileExtension(file.name).toLocaleUpperCase() || 'FILE'
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
  uploading,
  uploads,
  onChange,
}: {
  disabled: boolean
  uploading: boolean
  uploads: QueuedUpload[]
  onChange: (uploads: QueuedUpload[]) => void
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  const previewUnavailable = uploads.some(
    (upload) =>
      !upload.issue &&
      !uploading &&
      PREVIEWABLE_EXTENSIONS.has(documentUploadFileExtension(upload.file.name)),
  )

  const addFiles = (files: File[]) => {
    if (!disabled && files.length) onChange(mergeFiles(uploads, files))
  }

  return (
    <div className="mx-4 mb-4 space-y-2 border-t border-divider-subtle pt-4">
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
          'flex min-h-20 flex-col items-center justify-center rounded-lg border border-dashed border-divider-regular px-4 py-3 text-center outline-hidden transition-colors motion-reduce:transition-none',
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
        <span
          aria-hidden
          className={cn(
            'size-5 text-text-tertiary',
            uploading
              ? 'i-ri-loader-2-line animate-spin motion-reduce:animate-none'
              : 'i-ri-upload-cloud-2-line',
          )}
        />
        <span className="mt-1.5 system-sm-medium text-text-primary">
          {uploading
            ? t(($) => $['newKnowledge.uploadingFiles'])
            : t(($) => $['newKnowledge.uploadFiles'])}
        </span>
        <span className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.documentsDropHint'])}
        </span>
      </label>

      {!!uploads.length && (
        <ul className="space-y-1.5" aria-label={t(($) => $['newKnowledge.uploadFiles'])}>
          {uploads.map((upload) => (
            <li
              key={upload.id}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg border border-divider-subtle bg-background-default px-3 py-2',
                upload.issue && 'border-components-option-card-option-border',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'system-2xs-semibold flex h-7 min-w-9 shrink-0 items-center justify-center rounded bg-background-section px-1',
                  upload.issue ? 'text-text-destructive' : 'text-text-tertiary',
                )}
              >
                {uploading && !upload.issue ? (
                  <span className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none" />
                ) : (
                  fileBadge(upload.file)
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate system-xs-medium text-text-primary">
                  {upload.file.name}
                </span>
                <span
                  className={cn(
                    'block system-2xs-regular text-text-tertiary',
                    upload.issue && 'text-text-destructive',
                  )}
                >
                  {uploading && !upload.issue
                    ? t(($) => $['newKnowledge.uploadingFiles'])
                    : upload.issue === 'fileSize'
                      ? t(($) => $['newKnowledge.documentUploadExclusion.fileSize'])
                      : upload.issue === 'fileType'
                        ? t(($) => $['newKnowledge.documentUploadExclusion.fileType'])
                        : `${formatFileSize(upload.file.size)} · ${t(($) => $['newKnowledge.uploadCharactersUnavailable'])}`}
                </span>
              </span>
              {!uploading &&
                !upload.issue &&
                PREVIEWABLE_EXTENSIONS.has(documentUploadFileExtension(upload.file.name)) && (
                  <button
                    type="button"
                    disabled
                    aria-describedby={`${inputId}-preview-unavailable`}
                    className="h-7 shrink-0 rounded-md px-2 system-xs-medium text-text-disabled"
                  >
                    {t(($) => $['newKnowledge.preview'])}
                  </button>
                )}
              <button
                type="button"
                disabled={disabled}
                aria-label={`${tCommon(($) => $['operation.remove'])} ${upload.file.name}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
                onClick={() => onChange(uploads.filter((candidate) => candidate.id !== upload.id))}
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {previewUnavailable && (
        <p id={`${inputId}-preview-unavailable`} className="system-2xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.previewUnavailable'])}
        </p>
      )}
    </div>
  )
}
