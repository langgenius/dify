'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
      className="mx-auto flex w-full max-w-[640px] flex-1 flex-col pt-8"
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
        className="flex min-h-44 w-full flex-col items-center justify-center rounded-xl border border-dashed border-divider-regular bg-background-section px-6 py-9 text-center outline-hidden transition-colors hover:border-state-accent-solid hover:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
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
        <span className="flex size-11 items-center justify-center rounded-xl bg-background-default-subtle">
          <span aria-hidden className="i-ri-file-upload-line size-[22px] text-text-tertiary" />
        </span>
        <span className="mt-3 system-sm-medium text-text-primary">
          {t(($) => $['newKnowledge.uploadFiles'])}
        </span>
        <span className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.documentsDropHint'])}
        </span>
        <span className="mt-1 system-2xs-regular text-text-quaternary">
          PDF, DOCX, Markdown, HTML, XLSX, TXT · 15 MB
        </span>
      </button>

      {files.length > 0 && (
        <section className="mt-6" aria-label={t(($) => $['newKnowledge.uploadDocuments'])}>
          <div className="flex items-center justify-between">
            <h3 className="system-sm-semibold text-text-primary">
              {t(($) => $['newKnowledge.uploadDocuments'])}
            </h3>
            <span className="system-xs-regular text-text-tertiary">
              {validFiles.length} / {files.length}
            </span>
          </div>
          <ul className="mt-3 space-y-2">
            {files.map((file, index) => {
              const issue = documentUploadIssue(file)
              const extension = documentUploadFileExtension(file.name).toLocaleUpperCase()
              return (
                <li
                  key={`${file.name}:${file.size}:${file.lastModified}`}
                  className={cn(
                    'flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2.5',
                    issue
                      ? 'border-state-destructive-border bg-state-destructive-hover'
                      : 'border-divider-subtle bg-background-default',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-lg',
                      issue
                        ? 'bg-state-destructive-hover text-text-destructive'
                        : 'bg-background-section text-text-accent',
                    )}
                  >
                    <span aria-hidden className="i-ri-file-text-fill size-5" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate system-xs-medium text-text-primary">
                      {file.name}
                    </span>
                    <span className="mt-0.5 block system-2xs-regular text-text-tertiary">
                      {extension || 'FILE'} · {fileSize(file.size)}
                    </span>
                    {issue && (
                      <span className="mt-0.5 block system-2xs-regular text-text-destructive">
                        {t(($) => $[`newKnowledge.documentUploadExclusion.${issue}`])}
                      </span>
                    )}
                  </span>
                  <button
                    aria-label={`${tCommon(($) => $['operation.remove'])} · ${file.name}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    disabled={uploading}
                    type="button"
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, currentIndex) => currentIndex !== index),
                      )
                    }
                  >
                    <span aria-hidden className="i-ri-close-line size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="mt-8 flex justify-end gap-2 border-t border-divider-subtle pt-4">
        <Button disabled={uploading} type="button" onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          aria-busy={uploading}
          disabled={!validFiles.length || uploading}
          loading={uploading}
          type="submit"
          variant="primary"
        >
          {t(($) => $['newKnowledge.addDocument'])}
        </Button>
      </div>
    </form>
  )
}
