'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FilePreviewContent } from '@/app/components/base/file-uploader/file-preview-content'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { TransferMethod } from '@/types/app'
import { documentUploadFileExtension } from './policy'

function LocalTextFilePreviewBody({ file }: { file: File }) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
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
    <>
      <DialogHeader>
        <div className="system-2xs-semibold-uppercase text-text-accent">{t(($) => $.preview)}</div>
        <DialogTitle>{file.name}</DialogTitle>
        <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
      </DialogHeader>
      <div className="min-h-0 flex-1 bg-background-default-subtle p-4">
        {content === undefined && !readFailed && (
          <div className="flex size-full items-center justify-center">
            <LoadingPlaceholder />
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
    </>
  )
}

export function LocalFilePreview({
  file,
  onOpenChange,
  open,
}: {
  file?: File
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <Dialog open={open && Boolean(file)} onOpenChange={onOpenChange}>
      {file &&
        (documentUploadFileExtension(file.name) === 'pdf' ? (
          // The preview content owns the object URL for the lifetime of its mounted popup.
          <FilePreviewContent
            kind="pdf"
            file={{
              id: file.name,
              name: file.name,
              originalFile: file,
              size: file.size,
              type: 'application/pdf',
              progress: 100,
              transferMethod: TransferMethod.local_file,
              supportFileType: 'document',
            }}
          />
        ) : (
          <DialogContent className="h-[80dvh] max-h-180 w-240 overflow-hidden">
            <LocalTextFilePreviewBody file={file} />
          </DialogContent>
        ))}
    </Dialog>
  )
}
