import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { t } from 'i18next'
import { createPortal } from 'react-dom'
import { RiAddBoxLine, RiCloseLine, RiDownloadCloud2Line, RiZoomInLine, RiZoomOutLine } from '@remixicon/react'

import Tooltip from '@/app/components/base/tooltip'
import Toast from '@/app/components/base/toast'

type ImagePreviewProps = {
  url: string
  title: string
  onCancel: () => void
}

const isBase64 = (str: string): boolean => {
  try {
    return Buffer.from(str, 'base64').toString('base64') === str
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
    if (url.startsWith('http') || url.startsWith('https') || url.startsWith('data:image')) {
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

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const delta = e.deltaY < 0 ? 1 : -1
    setScale(prevScale => Math.max(prevScale + delta, 0.5))
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

  return createPortal(
    <div className='fixed inset-0 p-8 flex items-center justify-center bg-black/80 z-[1000] image-preview-container'
      onClick={e => e.stopPropagation()}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ cursor: scale > 1 ? 'move' : 'default' }}>
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
      <Tooltip popupContent={(t('common.operation.zoomOut') ?? 'Zoom Out')}>
        <div className='absolute top-6 right-40 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={zoomOut}>
          <RiZoomOutLine className='w-4 h-4 text-white'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={(t('common.operation.zoomIn') ?? 'Zoom In')}>
        <div className='absolute top-6 right-32 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={zoomIn}>
          <RiZoomInLine className='w-4 h-4 text-white'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={(t('common.operation.download') ?? 'Download Image')}>
        <div className='absolute top-6 right-24 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={downloadImage}>
          <RiDownloadCloud2Line className='w-4 h-4 text-white'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={(t('common.operation.openInNewTab') ?? 'Open in new tab')}>
        <div className='absolute top-6 right-16 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={openInNewTab}>
          <RiAddBoxLine className='w-4 h-4 text-white'/>
        </div>
      </Tooltip>
      <Tooltip popupContent={(t('common.operation.close') ?? 'Close Windows')}>
        <div
          className='absolute top-6 right-6 flex items-center justify-center w-8 h-8 bg-white/8 rounded-lg backdrop-blur-[2px] cursor-pointer'
          onClick={onCancel}>
          <RiCloseLine className='w-4 h-4 text-white'/>
        </div>
      </Tooltip>
    </div>,
    document.body,
  )
}

export default ImagePreview
