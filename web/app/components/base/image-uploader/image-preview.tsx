import type { FC } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import { downloadUrl } from '@/utils/download'

type ImagePreviewProps = {
  url: string
  title: string
  onCancel: () => void
  onPrev?: () => void
  onNext?: () => void
}

const isBase64 = (str: string): boolean => {
  try {
    return btoa(atob(str)) === str
  }
  catch {
    return false
  }
}

const ImagePreview: FC<ImagePreviewProps> = ({
  url,
  title,
  onCancel,
  onPrev,
  onNext,
}) => {
  const { t } = useTranslation()
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const [isCopied, setIsCopied] = useState(false)

  const openInNewTab = () => {
    // Open in a new window, considering the case when the page is inside an iframe
    if (url.startsWith('http') || url.startsWith('https')) {
      window.open(url, '_blank')
    }
    else if (url.startsWith('data:image')) {
      // Base64 image
      const win = window.open()
      win?.document.write(`<img src="${url}" alt="${title}" />`)
    }
    else {
      toast.error(`Unable to open image: ${url}`)
    }
  }

  const downloadImage = () => {
    // Open in a new window, considering the case when the page is inside an iframe
    if (url.startsWith('http') || url.startsWith('https') || url.startsWith('data:image')) {
      downloadUrl({ url, fileName: title, target: '_blank' })
      return
    }
    toast.error(`Unable to open image: ${url}`)
  }

  const zoomIn = () => {
    setScale(prevScale => Math.min(prevScale * 1.2, 15))
  }

  const zoomOut = () => {
    setScale((prevScale) => {
      const newScale = Math.max(prevScale / 1.2, 0.5)
      if (newScale === 1)
        setPosition({ x: 0, y: 0 }) // Reset position when fully zoomed out

      return newScale
    })
  }

  const imageBase64ToBlob = (base64: string, type = 'image/png'): Blob => {
    const byteCharacters = atob(base64)
    const byteArrays = []

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512)
      const byteNumbers = Array.from({ length: slice.length })
      for (let i = 0; i < slice.length; i++)
        byteNumbers[i] = slice.charCodeAt(i)

      const byteArray = new Uint8Array(byteNumbers as any)
      byteArrays.push(byteArray)
    }

    return new Blob(byteArrays, { type })
  }

  const imageCopy = useCallback(() => {
    const shareImage = async () => {
      try {
        const base64Data = url.split(',')[1]
        const blob = imageBase64ToBlob(base64Data!, 'image/png')

        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob,
          }),
        ])
        setIsCopied(true)

        toast.success(t('operation.imageCopied', { ns: 'common' }))
      }
      catch (err) {
        console.error('Failed to copy image:', err)

        downloadUrl({ url, fileName: `${title}.png` })

        toast.info(t('operation.imageDownloaded', { ns: 'common' }))
      }
    }
    shareImage()
  }, [t, title, url])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0)
      zoomIn()
    else
      zoomOut()
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (scale > 1) {
      setIsDragging(true)
      dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    }
  }, [scale, position])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging && scale > 1) {
      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y

      // Calculate boundaries
      const imgRect = imgRef.current?.getBoundingClientRect()
      const containerRect = imgRef.current?.parentElement?.getBoundingClientRect()

      if (imgRect && containerRect) {
        const maxX = (imgRect.width * scale - containerRect.width) / 2
        const maxY = (imgRect.height * scale - containerRect.height) / 2

        setPosition({
          x: Math.max(-maxX, Math.min(maxX, deltaX)),
          y: Math.max(-maxY, Math.min(maxY, deltaY)),
        })
      }
    }
  }, [isDragging, scale])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseUp])

  useHotkeys('up', zoomIn)
  useHotkeys('down', zoomOut)
  useHotkeys('left', onPrev || noop)
  useHotkeys('right', onNext || noop)

  const copyImageLabel = t('operation.copyImage', { ns: 'common' })
  const zoomOutLabel = t('operation.zoomOut', { ns: 'common' })
  const zoomInLabel = t('operation.zoomIn', { ns: 'common' })
  const downloadLabel = t('operation.download', { ns: 'common' })
  const openInNewTabLabel = t('operation.openInNewTab', { ns: 'common' })
  const cancelLabel = t('operation.cancel', { ns: 'common' })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
      disablePointerDismissal
    >
      <DialogContent
        className="image-preview-container inset-0! top-0! left-0! flex h-dvh! max-h-none! w-screen! max-w-none! translate-x-0! translate-y-0! items-center justify-center overflow-hidden! rounded-none! border-none! bg-black/80 p-8! shadow-none!"
        backdropClassName="bg-transparent!"
      >
        <div
          aria-label={title}
          data-testid="image-preview-container"
          tabIndex={-1}
          className="flex h-full w-full items-center justify-center"
          onClick={e => e.stopPropagation()}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ cursor: scale > 1 ? 'move' : 'default' }}
        >
          <img
            ref={imgRef}
            alt={title}
            src={isBase64(url) ? `data:image/png;base64,${url}` : url}
            className="max-h-full max-w-full"
            style={{
              transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
              transition: isDragging ? 'none' : 'transform 0.2s ease-in-out',
            }}
            data-testid="image-preview-image"
          />
        </div>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={copyImageLabel}
                className="absolute top-6 right-48 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
                onClick={imageCopy}
              >
                {isCopied
                  ? <span className="i-ri-file-copy-line h-4 w-4 text-green-500" data-testid="image-preview-copied-icon" />
                  : <span className="i-ri-file-copy-line h-4 w-4 text-gray-500" data-testid="image-preview-copy-button" />}
              </button>
            )}
          />
          <TooltipContent>
            {copyImageLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={zoomOutLabel}
                className="absolute top-6 right-40 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
                onClick={zoomOut}
              >
                <span className="i-ri-zoom-out-line h-4 w-4 text-gray-500" data-testid="image-preview-zoom-out-button" />
              </button>
            )}
          />
          <TooltipContent>
            {zoomOutLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={zoomInLabel}
                className="absolute top-6 right-32 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
                onClick={zoomIn}
              >
                <span className="i-ri-zoom-in-line h-4 w-4 text-gray-500" data-testid="image-preview-zoom-in-button" />
              </button>
            )}
          />
          <TooltipContent>
            {zoomInLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={downloadLabel}
                className="absolute top-6 right-24 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
                onClick={downloadImage}
              >
                <span className="i-ri-download-cloud-2-line h-4 w-4 text-gray-500" data-testid="image-preview-download-button" />
              </button>
            )}
          />
          <TooltipContent>
            {downloadLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={openInNewTabLabel}
                className="absolute top-6 right-16 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
                onClick={openInNewTab}
              >
                <span className="i-ri-add-box-line h-4 w-4 text-gray-500" data-testid="image-preview-open-in-tab-button" />
              </button>
            )}
          />
          <TooltipContent>
            {openInNewTabLabel}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                type="button"
                aria-label={cancelLabel}
                className="absolute top-6 right-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/8 backdrop-blur-[2px]"
                onClick={onCancel}
              >
                <span className="i-ri-close-line h-4 w-4 text-gray-500" data-testid="image-preview-close-button" />
              </button>
            )}
          />
          <TooltipContent>
            {cancelLabel}
          </TooltipContent>
        </Tooltip>
      </DialogContent>
    </Dialog>
  )
}

export default ImagePreview
