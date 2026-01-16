import { RiArrowLeftLine, RiArrowRightLine, RiCloseLine, RiRefreshLine } from '@remixicon/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import Button from '@/app/components/base/button'
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

const ImagePreviewer = ({
  images,
  initialIndex = 0,
  onClose,
}: ImagePreviewerProps) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [cachedImages, setCachedImages] = useState<Record<string, CachedImage>>(() => {
    return images.reduce((acc, image) => {
      acc[image.url] = {
        status: 'loading',
        width: 0,
        height: 0,
      }
      return acc
    }, {} as Record<string, CachedImage>)
  })
  const isMounted = useRef(false)

  const fetchImage = useCallback(async (image: ImageInfo) => {
    const { url } = image
    // Skip if already cached
    if (imageCache.has(url))
      return

    try {
      const res = await fetch(url)
      if (!res.ok)
        throw new Error(`Failed to load: ${url}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)

      const img = new Image()
      img.src = blobUrl
      img.onload = () => {
        if (!isMounted.current)
          return
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
    }
    catch {
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
        if (blobUrl)
          URL.revokeObjectURL(blobUrl)
        imageCache.delete(key)
      })
    }
  }, [])

  const currentImage = useMemo(() => {
    return images[currentIndex]
  }, [images, currentIndex])

  const prevImage = useCallback(() => {
    if (currentIndex === 0)
      return
    setCurrentIndex(prevIndex => prevIndex - 1)
  }, [currentIndex])

  const nextImage = useCallback(() => {
    if (currentIndex === images.length - 1)
      return
    setCurrentIndex(prevIndex => prevIndex + 1)
  }, [currentIndex, images.length])

  const retryImage = useCallback((image: ImageInfo) => {
    setCachedImages((prev) => {
      return {
        ...prev,
        [image.url]: {
          ...prev[image.url],
          status: 'loading',
        },
      }
    })
    fetchImage(image)
  }, [fetchImage])

  useHotkeys('esc', onClose)
  useHotkeys('left', prevImage)
  useHotkeys('right', nextImage)

  return createPortal(
    <div
      className="image-previewer fixed inset-0 z-[10000] flex items-center justify-center bg-background-overlay-fullscreen p-5 pb-4 backdrop-blur-[6px]"
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
    >
      <div className="absolute right-6 top-6 z-10 flex cursor-pointer flex-col items-center gap-y-1">
        <Button
          variant="tertiary"
          onClick={onClose}
          className="size-9 rounded-[10px] p-0"
          size="large"
        >
          <RiCloseLine className="size-5" />
        </Button>
        <span className="system-2xs-medium-uppercase text-text-tertiary">
          Esc
        </span>
      </div>
      {cachedImages[currentImage.url].status === 'loading' && (
        <Loading type="app" />
      )}
      {cachedImages[currentImage.url].status === 'error' && (
        <div className="system-sm-regular flex max-w-sm flex-col items-center gap-y-2 text-text-tertiary">
          <span>{`Failed to load image: ${currentImage.url}. Please try again.`}</span>
          <Button
            variant="secondary"
            onClick={() => retryImage(currentImage)}
            className="size-9 rounded-full p-0"
            size="large"
          >
            <RiRefreshLine className="size-5" />
          </Button>
        </div>
      )}
      {cachedImages[currentImage.url].status === 'loaded' && (
        <div className="flex size-full flex-col items-center justify-center gap-y-2">
          <img
            alt={currentImage.name}
            src={cachedImages[currentImage.url].blobUrl}
            className="max-h-[calc(100%-2.5rem)] max-w-full object-contain shadow-lg ring-8 ring-effects-image-frame backdrop-blur-[5px]"
          />
          <div className="system-sm-regular flex shrink-0 gap-x-2 pb-1 pt-3 text-text-tertiary">
            <span>{currentImage.name}</span>
            <span>·</span>
            <span>{`${cachedImages[currentImage.url].width} ×  ${cachedImages[currentImage.url].height}`}</span>
            <span>·</span>
            <span>{formatFileSize(currentImage.size)}</span>
          </div>
        </div>
      )}
      <Button
        variant="secondary"
        onClick={prevImage}
        className="absolute left-8 top-1/2 z-10 size-9 -translate-y-1/2 rounded-full p-0"
        disabled={currentIndex === 0}
        size="large"
      >
        <RiArrowLeftLine className="size-5" />
      </Button>
      <Button
        variant="secondary"
        onClick={nextImage}
        className="absolute right-8 top-1/2 z-10 size-9 -translate-y-1/2 rounded-full p-0"
        disabled={currentIndex === images.length - 1}
        size="large"
      >
        <RiArrowRightLine className="size-5" />
      </Button>
    </div>,
    document.body,
  )
}

export default ImagePreviewer
