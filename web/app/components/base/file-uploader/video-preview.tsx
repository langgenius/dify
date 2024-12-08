import type { FC } from 'react'
import { createPortal } from 'react-dom'
import { RiCloseLine } from '@remixicon/react'
import React, { useEffect, useRef } from 'react'

type VideoPreviewProps = {
  url: string
  title: string
  onCancel: () => void
}
const VideoPreview: FC<VideoPreviewProps> = ({
  url,
  title,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

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
    <div
      className='fixed inset-0 p-8 flex items-center justify-center bg-black/80 z-[1000]'
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
    >
      <div>
        <video controls title={title} autoPlay={false} preload="metadata">
          <source
            type="video/mp4"
            src={url}
            className='max-w-full max-h-full'
          />
        </video>
      </div>
      <div
        className='absolute top-6 right-6 flex items-center justify-center w-8 h-8 bg-white/[0.08] rounded-lg backdrop-blur-[2px] cursor-pointer'
        onClick={onCancel}
      >
        <RiCloseLine className='w-4 h-4 text-gray-500'/>
      </div>
    </div>
    ,
    document.body,
  )
}

export default VideoPreview
