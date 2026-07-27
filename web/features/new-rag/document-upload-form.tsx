'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DOCUMENT_UPLOAD_ACCEPT,
  documentUploadFileExtension,
  documentUploadIssue,
} from './document-upload-policy'

function fileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function fileIconClass(extension: string) {
  if (extension === 'PDF') return 'i-ri-file-pdf-2-fill text-text-destructive'
  if (extension === 'DOC' || extension === 'DOCX') return 'i-ri-file-word-2-fill text-text-accent'
  if (extension === 'XLS' || extension === 'XLSX') return 'i-ri-file-excel-fill text-text-success'
  return 'i-ri-file-text-fill text-text-tertiary'
}

export function DocumentUploadForm({
  initialFiles = [],
  onCancel,
  onSubmit,
  uploading,
}: {
  initialFiles?: File[]
  onCancel: () => void
  onSubmit: (files: File[]) => Promise<boolean>
  uploading: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState(initialFiles)
  const validFiles = useMemo(() => files.filter((file) => !documentUploadIssue(file)), [files])

  const addFiles = (nextFiles: File[]) => {
    setFiles((current) => {
      const fingerprints = new Set(
        current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
      )
      const uniqueFiles = []
      for (const file of nextFiles) {
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}`
        if (fingerprints.has(fingerprint)) continue
        fingerprints.add(fingerprint)
        uniqueFiles.push(file)
      }
      return [...current, ...uniqueFiles]
    })
  }

  return (
    <form
      aria-labelledby="new-knowledge-documents-title"
      className="mt-4 flex w-full max-w-[640px] flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (!validFiles.length || uploading) return
        void onSubmit(validFiles)
      }}
    >
      <input
        ref={inputRef}
        multiple
        hidden
        accept={DOCUMENT_UPLOAD_ACCEPT}
        aria-label={t(($) => $['newKnowledge.uploadDocuments'])}
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          addFiles([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ''
        }}
      />
      <button
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-divider-regular bg-background-section px-6 py-9 text-center outline-hidden transition-colors hover:border-state-accent-solid hover:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
        disabled={uploading}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = uploading ? 'none' : 'copy'
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (!uploading) addFiles([...event.dataTransfer.files])
        }}
      >
        <span className="flex size-11 items-center justify-center rounded-[10px] bg-background-default-subtle">
          <span aria-hidden className="i-ri-file-text-fill size-[22px] text-text-accent" />
        </span>
        <span className="system-md-medium text-text-primary">
          {t(($) => $['newKnowledge.uploadDropZoneTitle'])}
        </span>
        <span className="system-xs-regular text-text-quaternary">
          {t(($) => $['newKnowledge.documentUploadFormats'])}
        </span>
      </button>

      {files.length > 0 && (
        <section className="mt-4" aria-label={t(($) => $['newKnowledge.uploadDocuments'])}>
          <h3 className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.selectedFiles'], {
              total: files.length,
              valid: validFiles.length,
            })}
          </h3>
          <ul className="mt-2 space-y-1">
            {files.map((file, index) => {
              const issue = documentUploadIssue(file)
              const extension = documentUploadFileExtension(file.name).toLocaleUpperCase()
              const previewAvailable = !issue && (extension === 'DOC' || extension === 'DOCX')
              return (
                <li
                  key={`${file.name}:${file.size}:${file.lastModified}`}
                  className={cn(
                    'flex min-h-12 items-center overflow-hidden rounded-lg border-[0.5px] shadow-xs',
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
                      {file.name}
                    </span>
                    <span className="mt-0.5 flex min-h-3 items-center gap-1 system-2xs-medium text-text-tertiary">
                      {extension || 'FILE'} · {fileSize(file.size)}
                      {issue && (
                        <>
                          <span aria-hidden className="text-text-quaternary">
                            ·
                          </span>
                          <span className="truncate text-text-destructive">
                            {t(($) => $[`newKnowledge.documentUploadExclusion.${issue}`])}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 py-2 pr-3">
                    {previewAvailable && (
                      <Button
                        size="small"
                        type="button"
                        onClick={() => toast.info(t(($) => $['newKnowledge.previewUnavailable']))}
                      >
                        {t(($) => $['newKnowledge.preview'])}
                      </Button>
                    )}
                    <button
                      aria-label={`${tCommon(($) => $['operation.remove'])} · ${file.name}`}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      disabled={uploading}
                      type="button"
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index),
                        )
                      }
                    >
                      <span aria-hidden className="i-ri-delete-bin-line size-4" />
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="mt-4 flex justify-end gap-3 pt-5">
        <Button disabled={uploading} type="button" onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          aria-label={t(($) => $['newKnowledge.addDocument'])}
          aria-busy={uploading}
          disabled={!validFiles.length || uploading}
          loading={uploading}
          type="submit"
          variant="primary"
        >
          {t(($) => $['newKnowledge.addAndProcess'])}
        </Button>
      </div>
    </form>
  )
}
