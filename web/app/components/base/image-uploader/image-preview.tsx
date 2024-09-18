import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { t } from 'i18next'
import { createPortal } from 'react-dom'
import { RiAddBoxLine, RiCloseLine, RiDownloadCloud2Line, RiFileCopyLine, RiZoomInLine, RiZoomOutLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import Toast from '@/app/components/base/toast'

type ImagePreviewProps = {
  url: string
  title: string
  onCancel: () => void
}

const isBase64 = (str: string): boolean => {
  try {
    return btoa(atob(str)) === str
  }
  catch (err) {
    return false
  }
}

const ImagePreview: FC<ImagePreviewProps> = ({
  url,
  title,
  onCancel,
}) => {
  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const [isCopied, setIsCopied] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
      a.download = title
      a.click()
    }
    else if (url.startsWith('data:image')) {
      // Base64 image
      const a = document.createElement('a')
      a.href = url
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

  const imageTobase64ToBlob = (base64: string, type = 'image/png'): Blob => {
    const byteCharacters = atob(base64)
    const byteArrays = []

    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512)
      const byteNumbers = new Array(slice.length)
      for (let i = 0; i < slice.length; i++)
        byteNumbers[i] = slice.charCodeAt(i)

      const byteArray = new Uint8Array(byteNumbers)
      byteArrays.push(byteArray)
    }

    return new Blob(byteArrays, { type })
  }

  const imageCopy = useCallback(() => {
    const shareImage = async () => {
      try {
        const base64Data = url.split(',')[1]
        const blob = imageTobase64ToBlob(base64Data, 'image/png')

        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob,
          }),
        ])
        setIsCopied(true)

        Toast.notify({
          type: 'success',
          message: t('common.operation.imageCopied'),
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
          message: t('common.operation.imageDownloaded'),
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        onCancel()
    }

    window.addEventListener('keydown', handleKeyDown)

    // Set focus to the container element
    if (containerRef.current)
      containerRef.current.focus()

    // Cleanup function
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onCancel])

  return createPortal(
    <div className='fixed inset-0 p-8 flex items-center justify-center bg-black/80 z-[1000] image-preview-container'
      onClick={e => e.stopPropagation()}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ cursor: scale > 1 ? 'move' : 'default' }}
      tabIndex={-1}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        alt={title}
        src={isBase64(url) ? `data:image/png;base64,${url}` : url}
        className='max-w-full max-h-full'
        style={{
          transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-in-out',
        }}
      />
      <Tooltip popupContent={t('common.operation.copyImage')}>
        <div className='absolute top-6 right-48 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={imageCopy}>
          {isCopied
            ? <RiFileCopyLine className='w-4 h-4 text-green-500'/>
            : <RiFileCopyLine className='w-4 h-4 text-gray-500'/>}
        </div>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.zoomOut')}>
        <div className='absolute top-6 right-40 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={zoomOut}>
          <RiZoomOutLine className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.zoomIn')}>
        <div className='absolute top-6 right-32 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={zoomIn}>
          <RiZoomInLine className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.download')}>
        <div className='absolute top-6 right-24 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={downloadImage}>
          <RiDownloadCloud2Line className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.openInNewTab')}>
        <div className='absolute top-6 right-16 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={openInNewTab}>
          <RiAddBoxLine className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={t('common.operation.close')}>
        <div
          className='absolute top-6 right-6 flex items-center justify-center w-8 h-8 bg-white/8 rounded-lg backdrop-blur-[2px] cursor-pointer'
          onClick={onCancel}>
          <RiCloseLine className='w-4 h-4 text-gray-500'/>
        </div>
      </Tooltip>
    </div>,
    document.body,
  )
}

export default ImagePreview
