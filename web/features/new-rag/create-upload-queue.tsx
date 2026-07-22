'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
  'csv',
  'doc',
  'docx',
  'htm',
  'html',
  'jsonl',
  'markdown',
  'md',
  'pdf',
  'txt',
  'xls',
  'xlsx',
])

const CREATE_UPLOAD_ACCEPT = [...ALLOWED_EXTENSIONS].map((extension) => `.${extension}`).join(',')

export type QueuedUpload = {
  file: File
  id: string
  issue?: 'fileSize' | 'fileType'
}

function fileExtension(name: string) {
  const extension = name.split('.').pop()?.toLocaleLowerCase()
  return extension && extension !== name.toLocaleLowerCase() ? extension : ''
}

function createQueuedUpload(file: File): QueuedUpload {
  const extension = fileExtension(file.name)
  return {
    file,
    id: `${file.name}:${file.size}:${file.lastModified}:${globalThis.crypto.randomUUID()}`,
    issue:
      file.size > MAX_FILE_SIZE
        ? 'fileSize'
        : !ALLOWED_EXTENSIONS.has(extension)
          ? 'fileType'
          : undefined,
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
  uploads,
  onChange,
}: {
  disabled: boolean
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
    <div className="mt-3 space-y-2">
      <input
        id={inputId}
        className="peer sr-only"
        multiple
        type="file"
        accept={CREATE_UPLOAD_ACCEPT}
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
          'flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-divider-regular px-5 py-4 text-center outline-hidden transition-colors motion-reduce:transition-none',
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
        <span aria-hidden className="i-ri-upload-cloud-2-line size-6 text-text-tertiary" />
        <span className="mt-2 system-sm-medium text-text-primary">
          {t(($) => $['newKnowledge.uploadFiles'])}
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
                  'size-4 shrink-0',
                  upload.issue
                    ? 'i-ri-error-warning-line text-text-destructive'
                    : 'i-ri-file-text-line text-text-tertiary',
                )}
              />
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
                  {upload.issue === 'fileSize'
                    ? t(($) => $['newKnowledge.documentUploadExclusion.fileSize'])
                    : upload.issue === 'fileType'
                      ? t(($) => $['newKnowledge.documentUploadExclusion.fileType'])
                      : formatFileSize(upload.file.size)}
                </span>
              </span>
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
    </div>
  )
}
