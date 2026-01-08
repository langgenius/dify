import type { FC } from 'react'
import { RiAddBoxLine, RiCloseLine, RiDownloadCloud2Line, RiFileCopyLine, RiZoomInLine, RiZoomOutLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { t } from 'i18next'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'

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
      Toast.notify({
        type: 'error',
        message: `Unable to open image: ${url}`,
      })
    }
  }

  const downloadImage = () => {
    // Open in a new window, considering the case when the page is inside an iframe
    if (url.startsWith('http') || url.startsWith('https')) {
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.download = title
      a.click()
    }
    else if (url.startsWith('data:image')) {
      // Base64 image
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.download = title
      a.click()
    }
    else {
      Toast.notify({
        type: 'error',
        message: `Unable to open image: ${url}`,
      })
    }
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
        const blob = imageBase64ToBlob(base64Data, 'image/png')

        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob,
          }),
        ])
        setIsCopied(true)

        Toast.notify({
          type: 'success',
          message: t('operation.imageCopied', { ns: 'common' }),
        })
      }
      catch (err) {
        console.error('Failed to copy image:', err)

        const link = document.createElement('a')
        link.href = url
        link.download = `${title}.png`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)

        Toast.notify({
          type: 'info',
          message: t('operation.imageDownloaded', { ns: 'common' }),
        })
      }
    }
    shareImage()
  }, [title, url])

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

  useHotkeys('esc', onCancel)
  useHotkeys('up', zoomIn)
  useHotkeys('down', zoomOut)
  useHotkeys('left', onPrev || noop)
  useHotkeys('right', onNext || noop)

  return createPortal(
    <div
      className="image-preview-container fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-8"
      onClick={e => e.stopPropagation()}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ cursor: scale > 1 ? 'move' : 'default' }}
      tabIndex={-1}
    >
      { }
      <img
        ref={imgRef}
        alt={title}
        src={isBase64(url) ? `data:image/png;base64,${url}` : url}
        className="max-h-full max-w-full"
        style={{
          transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-in-out',
        }}
      />
      <Tooltip popupContent={t('operation.copyImage', { ns: 'common' })}>
        <div
          className="absolute right-48 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
          onClick={imageCopy}
        >
          {isCopied
            ? <RiFileCopyLine className="h-4 w-4 text-green-500" />
            : <RiFileCopyLine className="h-4 w-4 text-gray-500" />}
        </div>
      </Tooltip>
      <Tooltip popupContent={t('operation.zoomOut', { ns: 'common' })}>
        <div
          className="absolute right-40 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
          onClick={zoomOut}
        >
          <RiZoomOutLine className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
      <Tooltip popupContent={t('operation.zoomIn', { ns: 'common' })}>
        <div
          className="absolute right-32 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
          onClick={zoomIn}
        >
          <RiZoomInLine className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
      <Tooltip popupContent={t('operation.download', { ns: 'common' })}>
        <div
          className="absolute right-24 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
          onClick={downloadImage}
        >
          <RiDownloadCloud2Line className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
      <Tooltip popupContent={t('operation.openInNewTab', { ns: 'common' })}>
        <div
          className="absolute right-16 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg"
          onClick={openInNewTab}
        >
          <RiAddBoxLine className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
      <Tooltip popupContent={t('operation.cancel', { ns: 'common' })}>
        <div
          className="absolute right-6 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/8 backdrop-blur-[2px]"
          onClick={onCancel}
        >
          <RiCloseLine className="h-4 w-4 text-gray-500" />
        </div>
      </Tooltip>
    </div>,
    document.body,
  )
}

export default ImagePreview
