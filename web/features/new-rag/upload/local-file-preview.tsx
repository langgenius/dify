'use client'

import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DynamicPdfPreview from '@/app/components/base/file-uploader/dynamic-pdf-preview'
import Loading from '@/app/components/base/loading'
import { documentUploadFileExtension } from './policy'

function LocalPdfFilePreview({ file, onClose }: { file: File; onClose: () => void }) {
  const [previewUrl, setPreviewUrl] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = ''

    void Promise.resolve().then(() => {
      if (!active) return
      objectUrl = URL.createObjectURL(file.slice(0, file.size, 'application/pdf'))
      setPreviewUrl(objectUrl)
    })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  if (!previewUrl) return null

  return <DynamicPdfPreview url={previewUrl} onCancel={onClose} />
}

function LocalTextFilePreview({ file, onClose }: { file: File; onClose: () => void }) {
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const [content, setContent] = useState<string>()
  const [readFailed, setReadFailed] = useState(false)

  useEffect(() => {
    let active = true

    void file
      .text()
      .then((text) => {
        if (!active) return
        setContent(text)
      })
      .catch(() => {
        if (!active) return
        setReadFailed(true)
      })

    return () => {
      active = false
    }
  }, [file])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex h-[80dvh] max-h-180 w-240 flex-col overflow-hidden p-0">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-divider-subtle px-6 py-4">
          <div className="min-w-0">
            <div className="system-2xs-semibold-uppercase text-text-accent">
              {t(($) => $.preview)}
            </div>
            <DialogTitle className="mt-1 truncate title-md-semi-bold text-text-primary">
              {file.name}
            </DialogTitle>
          </div>
          <DialogClose
            render={
              <IconButton
                aria-label={tCommon(($) => $['operation.close'])}
                className="static shrink-0"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </header>
        <div className="min-h-0 flex-1 bg-background-default-subtle p-4">
          {content === undefined && !readFailed && (
            <div className="flex size-full items-center justify-center">
              <Loading type="area" />
            </div>
          )}
          {readFailed && (
            <div className="flex size-full items-center justify-center system-sm-regular text-text-tertiary">
              {tCommon(($) => $['fileUploader.uploadFromComputerReadError'])}
            </div>
          )}
          {content !== undefined && (
            <pre
              aria-label={file.name}
              className="size-full overflow-auto rounded-lg border border-components-panel-border bg-components-panel-bg p-4 font-mono text-[13px] leading-5.5 wrap-break-word whitespace-pre-wrap text-text-primary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              {content}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function LocalFilePreview({ file, onClose }: { file: File; onClose: () => void }) {
  if (documentUploadFileExtension(file.name) === 'pdf')
    return <LocalPdfFilePreview file={file} onClose={onClose} />

  return <LocalTextFilePreview file={file} onClose={onClose} />
}
