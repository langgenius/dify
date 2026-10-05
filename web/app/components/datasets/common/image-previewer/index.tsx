import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Kbd } from '@langgenius/dify-ui/kbd'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { formatFileSize } from '@/utils/format'

export type ImageInfo = {
  url: string
  name: string
  size: number
}

export type ImagePreviewPayload = {
  images: readonly ImageInfo[]
  initialIndex: number
}

type ImagePreviewerProps = {
  children: ReactNode
}

type ImageLoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; width: number; height: number }

function LoadSelectedImage({ image }: { image: ImageInfo }) {
  const { t } = useTranslation(['common'])
  const [loadState, setLoadState] = useState<ImageLoadState>({ status: 'loading' })

  if (loadState.status === 'error') {
    return (
      <div className="flex max-w-sm flex-col items-center gap-y-2 system-sm-regular text-text-tertiary">
        <span>{t(($) => $['imageUploader.uploadFromComputerReadError'], { ns: 'common' })}</span>
        <IconButton
          variant="secondary"
          size="xl"
          aria-label={t(($) => $['operation.retry'], { ns: 'common' })}
          onClick={() => setLoadState({ status: 'loading' })}
          className="rounded-full"
        >
          <span aria-hidden className="i-ri-refresh-line size-5" />
        </IconButton>
      </div>
    )
  }

  return (
    <div className="flex size-full flex-col items-center justify-center gap-y-2">
      {loadState.status === 'loading' && <LoadingPlaceholder className="h-full" />}
      <img
        alt={image.name}
        src={image.url}
        onLoad={(event) =>
          setLoadState({
            status: 'loaded',
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        onError={() => setLoadState({ status: 'error' })}
        className={cn(
          'max-h-[calc(100%-2.5rem)] max-w-full object-contain shadow-lg ring-8 ring-effects-image-frame backdrop-blur-[5px]',
          loadState.status === 'loading' && 'hidden',
        )}
      />
      {loadState.status === 'loaded' && (
        <div className="flex shrink-0 gap-x-2 pt-3 pb-1 system-sm-regular text-text-tertiary">
          <span>{image.name}</span>
          <span>·</span>
          <span>{`${loadState.width} ×  ${loadState.height}`}</span>
          <span>·</span>
          <span>{formatFileSize(image.size)}</span>
        </div>
      )}
    </div>
  )
}

function ImagePreviewPopup({ payload }: { payload: ImagePreviewPayload }) {
  const previewRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation(['common', 'workflow'])
  const [images] = useState(payload.images)
  const [currentIndex, setCurrentIndex] = useState(payload.initialIndex)
  const currentImage = images[currentIndex]

  const prevImage = () => setCurrentIndex((index) => Math.max(0, index - 1))
  const nextImage = () => setCurrentIndex((index) => Math.min(images.length - 1, index + 1))

  useHotkey('ArrowLeft', prevImage, {
    target: previewRef,
    enabled: currentIndex > 0,
    requireReset: true,
  })
  useHotkey('ArrowRight', nextImage, {
    target: previewRef,
    enabled: currentIndex < images.length - 1,
    requireReset: true,
  })

  if (!currentImage) return null

  return (
    <>
      <DialogBackdrop className="bg-transparent!" />
      <DialogPopup
        ref={previewRef}
        onClick={(event) => event.stopPropagation()}
        className="image-previewer fixed inset-0! top-0! left-0! flex h-dvh! max-h-none! w-screen! max-w-none! translate-x-0! translate-y-0! items-center justify-center overflow-hidden! rounded-none! border-none! bg-background-overlay-fullscreen p-5! pb-4! shadow-none! backdrop-blur-[6px]"
      >
        <DialogTitle className="sr-only">
          {currentImage.name.trim() || t(($) => $['common.preview'], { ns: 'workflow' })}
        </DialogTitle>
        <div className="absolute top-6 right-6 z-10 flex flex-col items-center gap-y-1">
          <DialogClose
            render={
              <IconButton
                variant="tertiary"
                size="xl"
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              >
                <span aria-hidden className="i-ri-close-line size-5" />
              </IconButton>
            }
          />
          <Kbd>{formatForDisplay('Escape')}</Kbd>
        </div>
        <LoadSelectedImage key={currentImage.url} image={currentImage} />
        <IconButton
          variant="secondary"
          size="xl"
          aria-label={t(($) => $['pagination.previous'], { ns: 'common' })}
          onClick={prevImage}
          className="absolute top-1/2 left-8 z-10 -translate-y-1/2 rounded-full"
          disabled={currentIndex === 0}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-5" />
        </IconButton>
        <IconButton
          variant="secondary"
          size="xl"
          aria-label={t(($) => $['pagination.next'], { ns: 'common' })}
          onClick={nextImage}
          className="absolute top-1/2 right-8 z-10 -translate-y-1/2 rounded-full"
          disabled={currentIndex === images.length - 1}
        >
          <span aria-hidden className="i-ri-arrow-right-line size-5" />
        </IconButton>
      </DialogPopup>
    </>
  )
}

export function ImagePreviewer({ children }: ImagePreviewerProps) {
  return (
    <Dialog<ImagePreviewPayload> disablePointerDismissal>
      {({ payload }) => (
        <>
          {children}
          <DialogPortal>
            {payload && (
              <ImagePreviewPopup
                key={payload.images[payload.initialIndex]?.url}
                payload={payload}
              />
            )}
          </DialogPortal>
        </>
      )}
    </Dialog>
  )
}
