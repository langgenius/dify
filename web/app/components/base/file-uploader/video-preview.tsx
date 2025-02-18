import type { FC } from 'react'
import { createPortal } from 'react-dom'
import { RiCloseLine } from '@remixicon/react'
import React from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

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
  useHotkeys('esc', onCancel)

  return createPortal(
    <div
      className='fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-8'
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
    >
      <div>
        <video controls title={title} autoPlay={false} preload="metadata">
          <source
            type="video/mp4"
            src={url}
            className='max-h-full max-w-full'
          />
        </video>
      </div>
      <div
        className='absolute right-6 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/[0.08] backdrop-blur-[2px]'
        onClick={onCancel}
      >
        <RiCloseLine className='h-4 w-4 text-gray-500'/>
      </div>
    </div>
    , document.body,
  )
}

export default VideoPreview
