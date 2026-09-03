import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Kbd } from '@langgenius/dify-ui/kbd'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { formatFileSize } from '@/utils/format'

type CachedImage = {
  blobUrl?: string
  status: 'loading' | 'loaded' | 'error'
  width: number
  height: number
}

const imageCache = new Map<string, CachedImage>()

export type ImageInfo = {
  url: string
  name: string
  size: number
}

type ImagePreviewerProps = {
  images: ImageInfo[]
  initialIndex?: number
  onClose: () => void
}

const ImagePreviewer = ({ images, initialIndex = 0, onClose }: ImagePreviewerProps) => {
  const { t } = useTranslation()
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [cachedImages, setCachedImages] = useState<Record<string, CachedImage>>(() => {
    return images.reduce(
      (acc, image) => {
        acc[image.url] = {
          status: 'loading',
          width: 0,
          height: 0,
        }
        return acc
      },
      {} as Record<string, CachedImage>,
    )
  })
  const isMounted = useRef(false)

  const fetchImage = useCallback(async (image: ImageInfo) => {
    const { url } = image
    // Skip if already cached
    if (imageCache.has(url)) return

    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Failed to load: ${url}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)

      const img = new Image()
      img.src = blobUrl
      img.onload = () => {
        if (!isMounted.current) return
        imageCache.set(url, {
          blobUrl,
          status: 'loaded',
          width: img.naturalWidth,
          height: img.naturalHeight,
        })
        setCachedImages((prev) => {
          return {
            ...prev,
            [url]: {
              blobUrl,
              status: 'loaded',
              width: img.naturalWidth,
              height: img.naturalHeight,
            },
          }
        })
      }
    } catch {
      if (isMounted.current) {
        setCachedImages((prev) => {
          return {
            ...prev,
            [url]: {
              status: 'error',
              width: 0,
              height: 0,
            },
          }
        })
      }
    }
  }, [])

  useEffect(() => {
    isMounted.current = true

    images.forEach((image) => {
      fetchImage(image)
    })

    return () => {
      isMounted.current = false
      // Cleanup released blob URLs not in current list
      imageCache.forEach(({ blobUrl }, key) => {
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        imageCache.delete(key)
      })
    }
  }, [])

  const currentImage = useMemo(() => {
    return images[currentIndex]
  }, [images, currentIndex])

  const prevImage = useCallback(() => {
    if (currentIndex === 0) return
    setCurrentIndex((prevIndex) => prevIndex - 1)
  }, [currentIndex])

  const nextImage = useCallback(() => {
    if (currentIndex === images.length - 1) return
    setCurrentIndex((prevIndex) => prevIndex + 1)
  }, [currentIndex, images.length])

  const retryImage = useCallback(
    (image: ImageInfo) => {
      setCachedImages((prev) => {
        return {
          ...prev,
          [image.url]: {
            ...prev[image.url]!,
            status: 'loading',
          },
        }
      })
      fetchImage(image)
    },
    [fetchImage],
  )

  useHotkey('ArrowLeft', prevImage)
  useHotkey('ArrowRight', nextImage)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      disablePointerDismissal
    >
      <DialogContent
        className="image-previewer inset-0! top-0! left-0! flex h-dvh! max-h-none! w-screen! max-w-none! translate-x-0! translate-y-0! items-center justify-center overflow-hidden! rounded-none! border-none! bg-background-overlay-fullscreen p-5! pb-4! shadow-none! backdrop-blur-[6px]"
        backdropProps={{ className: 'bg-transparent!' }}
      >
        <div className="absolute top-6 right-6 z-10 flex cursor-pointer flex-col items-center gap-y-1">
          <IconButton
            variant="tertiary"
            size="xl"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={onClose}
          >
            <span aria-hidden className="i-ri-close-line size-5" />
          </IconButton>
          <Kbd>{formatForDisplay('Escape')}</Kbd>
        </div>
        {cachedImages[currentImage!.url]!.status === 'loading' && <Loading type="app" />}
        {cachedImages[currentImage!.url]!.status === 'error' && (
          <div className="flex max-w-sm flex-col items-center gap-y-2 system-sm-regular text-text-tertiary">
            <span>{`Failed to load image: ${currentImage!.url}. Please try again.`}</span>
            <IconButton
              variant="secondary"
              size="xl"
              aria-label={t(($) => $['operation.retry'], { ns: 'common' })}
              onClick={() => retryImage(currentImage!)}
              className="rounded-full"
            >
              <span aria-hidden className="i-ri-refresh-line size-5" />
            </IconButton>
          </div>
        )}
        {cachedImages[currentImage!.url]!.status === 'loaded' && (
          <div className="flex size-full flex-col items-center justify-center gap-y-2">
            <img
              alt={currentImage!.name}
              src={cachedImages[currentImage!.url]!.blobUrl}
              className="max-h-[calc(100%-2.5rem)] max-w-full object-contain shadow-lg ring-8 ring-effects-image-frame backdrop-blur-[5px]"
            />
            <div className="flex shrink-0 gap-x-2 pt-3 pb-1 system-sm-regular text-text-tertiary">
              <span>{currentImage!.name}</span>
              <span>·</span>
              <span>{`${cachedImages[currentImage!.url]!.width} ×  ${cachedImages[currentImage!.url]!.height}`}</span>
              <span>·</span>
              <span>{formatFileSize(currentImage!.size)}</span>
            </div>
          </div>
        )}
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
      </DialogContent>
    </Dialog>
  )
}

export default ImagePreviewer
