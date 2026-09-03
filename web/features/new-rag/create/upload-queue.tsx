'use client'

import type { KnowledgeFsUploadPhase } from '../upload/knowledge-fs-upload'
import type { DocumentUploadIssue } from '../upload/policy'
import { cn } from '@langgenius/dify-ui/cn'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createRequestId } from '../request-id'
import { DocumentUploadFileList } from '../upload/file-list'
import {
  DOCUMENT_UPLOAD_ACCEPT,
  documentUploadIssue,
  uniqueDocumentUploadFiles,
} from '../upload/policy'

export type QueuedUpload = {
  file: File
  id: string
  issue?: DocumentUploadIssue
  stagedUploadId?: string
  stagingFailed?: boolean
}

function createQueuedUpload(file: File, fileSizeLimitMb: number): QueuedUpload {
  return {
    file,
    id: createRequestId(),
    issue: documentUploadIssue(file, fileSizeLimitMb),
  }
}

function mergeFiles(current: QueuedUpload[], files: File[], fileSizeLimitMb: number) {
  return [
    ...current,
    ...uniqueDocumentUploadFiles(
      current.map(({ file }) => file),
      files,
    ).map((file) => createQueuedUpload(file, fileSizeLimitMb)),
  ]
}

export function CreateUploadQueue({
  disabled,
  fileSizeLimitMb,
  uploadPhases = new Map(),
  uploading,
  uploads,
  onChange,
}: {
  disabled: boolean
  fileSizeLimitMb: number
  uploadPhases?: ReadonlyMap<File, KnowledgeFsUploadPhase>
  uploading: boolean
  uploads: QueuedUpload[]
  onChange: (uploads: QueuedUpload[]) => void
}) {
  const { t } = useTranslation('dataset')
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  const validUploadCount = uploads.filter(({ issue }) => !issue).length

  const addFiles = (files: File[]) => {
    if (!disabled && files.length) onChange(mergeFiles(uploads, files, fileSizeLimitMb))
  }

  return (
    <div className="mx-[14.5px] mt-[-3.5px] mb-[14.5px] space-y-3">
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
          {t(($) => $['newKnowledge.documentUploadFormats'], { size: fileSizeLimitMb })}
        </span>
      </label>

      {!!uploads.length && (
        <section aria-label={t(($) => $['newKnowledge.uploadFiles'])}>
          <h3 className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.selectedFiles'], {
              total: uploads.length,
              valid: validUploadCount,
            })}
          </h3>
          <DocumentUploadFileList
            ariaLabel={t(($) => $['newKnowledge.uploadFiles'])}
            className="mt-2"
            disabled={disabled}
            fileSizeLimitMb={fileSizeLimitMb}
            idleStatus={t(($) => $['newKnowledge.uploadCharactersUnavailable'])}
            items={uploads}
            uploadProgress={uploadPhases}
            variant="compact"
            onRemove={(upload) =>
              onChange(uploads.filter((candidate) => candidate.id !== upload.id))
            }
          />
        </section>
      )}
    </div>
  )
}
