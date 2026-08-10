'use client'

import type { KnowledgeFsUploadPhase } from './knowledge-fs-upload'
import { Button } from '@langgenius/dify-ui/button'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DocumentUploadFileList } from './document-upload-file-list'
import {
  DOCUMENT_UPLOAD_ACCEPT,
  documentUploadFingerprint,
  documentUploadIssue,
  uniqueDocumentUploadFiles,
} from './document-upload-policy'

export function DocumentUploadForm({
  initialFiles = [],
  onCancel,
  onSubmit,
  uploadProgress = new Map(),
  uploading,
}: {
  initialFiles?: File[]
  onCancel: () => void
  onSubmit: (files: File[]) => Promise<boolean>
  uploadProgress?: ReadonlyMap<File, KnowledgeFsUploadPhase>
  uploading: boolean
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState(initialFiles)
  const validFiles = useMemo(() => files.filter((file) => !documentUploadIssue(file)), [files])

  const addFiles = (nextFiles: File[]) => {
    setFiles((current) => {
      return [...current, ...uniqueDocumentUploadFiles(current, nextFiles)]
    })
  }

  return (
    <form
      aria-labelledby="new-knowledge-documents-title"
      className="flex w-full max-w-160 flex-1 flex-col"
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
        className="flex h-41 w-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-divider-deep bg-background-section px-6 text-center outline-hidden transition-colors hover:border-state-accent-solid hover:bg-state-accent-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
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
        <span className="flex size-11 items-center justify-center rounded-[10px] bg-components-icon-bg-midnight-soft">
          <span aria-hidden className="i-ri-file-text-fill size-5.5 text-text-accent" />
        </span>
        <span className="text-[14px] leading-[17px] font-medium text-text-primary">
          {t(($) => $['newKnowledge.uploadDropZoneTitle'])}
        </span>
        <span className="text-[12px] leading-[15px] font-normal text-text-placeholder">
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
          <DocumentUploadFileList
            className="mt-2"
            disabled={uploading}
            items={files.map((file) => ({
              file,
              id: documentUploadFingerprint(file),
            }))}
            uploadProgress={uploadProgress}
            onRemove={(item) => setFiles((current) => current.filter((file) => file !== item.file))}
          />
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
