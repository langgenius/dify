'use client'

import type { FileEntity } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

const PdfPreview = dynamic(() => import('./pdf-preview').then((module) => module.PdfPreview), {
  ssr: false,
  loading: () => <LoadingPlaceholder className="h-64" />,
})

type PreviewKind = 'audio' | 'video' | 'pdf'
type FilePreviewDialogProps = {
  file: FileEntity
  canPreview?: boolean
}

function FilePreviewPopup({ file, kind }: { file: FileEntity; kind: PreviewKind }) {
  const { t } = useTranslation(['common'])
  const media = useBreakpoints()
  const popupRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [source] = useState(() => ({
    url: file.url || file.base64Url,
    originalFile: file.originalFile,
  }))
  const [objectUrl, setObjectUrl] = useState<string>()
  useEffect(() => {
    if (source.url || !source.originalFile) return
    const url = URL.createObjectURL(source.originalFile.slice())
    // oxlint-disable-next-line eslint-react/set-state-in-effect -- Allocate Blob URLs after commit and pair them with Effect cleanup.
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [source])
  const url = source.url || objectUrl

  return (
    <>
      <DialogBackdrop className="bg-transparent!" />
      <DialogPopup
        ref={popupRef}
        initialFocus={closeRef}
        className={cn(
          'fixed inset-0! top-0! left-0! flex h-dvh! max-h-none! w-screen! max-w-none! translate-0! items-center justify-center overflow-hidden! rounded-none! border-none! bg-black/80 shadow-none!',
          kind === 'pdf' && media === MediaType.mobile ? 'p-0!' : 'p-8!',
        )}
      >
        <DialogTitle className="sr-only">{file.name}</DialogTitle>
        {url && kind === 'audio' && (
          <audio controls title={file.name} autoPlay={false} preload="metadata">
            <source type="audio/mpeg" src={url} className="max-h-full max-w-full" />
          </audio>
        )}
        {url && kind === 'video' && (
          <video controls title={file.name} autoPlay={false} preload="metadata">
            <source type="video/mp4" src={url} className="max-h-full max-w-full" />
          </video>
        )}
        {url && kind === 'pdf' && <PdfPreview url={url} popupRef={popupRef} />}
        <DialogClose
          render={
            <IconButton
              ref={closeRef}
              size="lg"
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute top-6 right-6 rounded-lg bg-white/8 backdrop-blur-[2px]"
            >
              <span className="i-ri-close-line size-4 text-gray-500" aria-hidden />
            </IconButton>
          }
        />
      </DialogPopup>
    </>
  )
}

export function FilePreviewDialog({ file, canPreview }: FilePreviewDialogProps) {
  const [category, subtype] = file.type?.split('/') ?? []
  const kind: PreviewKind | undefined =
    category === 'audio' || category === 'video' ? category : subtype === 'pdf' ? 'pdf' : undefined
  const filenameClassName = 'mb-1 line-clamp-2 h-8 system-xs-medium break-all text-text-tertiary'
  if (!canPreview || !kind || !(file.url || file.base64Url || file.originalFile))
    return (
      <div className={filenameClassName} title={file.name}>
        {file.name}
      </div>
    )

  return (
    <Dialog disablePointerDismissal>
      <DialogTrigger
        title={file.name}
        className={cn(
          filenameClassName,
          'w-full cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        )}
      >
        {file.name}
      </DialogTrigger>
      <DialogPortal>
        <FilePreviewPopup file={file} kind={kind} />
      </DialogPortal>
    </Dialog>
  )
}
