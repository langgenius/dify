'use client'

import type { FileEntity, FilePreviewKind } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'

const PdfPreview = dynamic(() => import('./pdf-preview').then((module) => module.PdfPreview), {
  ssr: false,
  loading: () => <LoadingPlaceholder className="h-64" />,
})

type FilePreviewContentProps = {
  file: FileEntity
  kind: FilePreviewKind
}

function FilePreviewPopup({ file, kind }: FilePreviewContentProps) {
  const { t } = useTranslation(['common'])
  const popupRef = useRef<HTMLDivElement>(null)
  // Close stays last so it paints above the scaled PDF layer; focus it explicitly instead.
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
      <DialogBackdrop className="bg-transparent" />
      <DialogPopup
        ref={popupRef}
        initialFocus={closeRef}
        className={cn(
          'fixed inset-0 flex h-dvh w-screen items-center justify-center overflow-hidden rounded-none border-none bg-black/80 p-8 shadow-none',
          kind === 'pdf' && 'max-sm:p-0',
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

export function FilePreviewContent(props: FilePreviewContentProps) {
  return (
    <DialogPortal>
      <FilePreviewPopup {...props} />
    </DialogPortal>
  )
}
