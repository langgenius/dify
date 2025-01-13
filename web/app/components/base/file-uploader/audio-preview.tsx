import type { FC } from 'react'
import { createPortal } from 'react-dom'
import { RiCloseLine } from '@remixicon/react'
import React from 'react'

import { useHotkeys } from 'react-hotkeys-hook'

type AudioPreviewProps = {
  url: string
  title: string
  onCancel: () => void
}
const AudioPreview: FC<AudioPreviewProps> = ({
  url,
  title,
  onCancel,
}) => {
  useHotkeys('esc', onCancel)

  return createPortal(
    <div
      className='fixed inset-0 p-8 flex items-center justify-center bg-black/80 z-[1000]'
      onClick={e => e.stopPropagation()}
      tabIndex={-1}
    >
      <div>
        <audio controls title={title} autoPlay={false} preload="metadata">
          <source
            type="audio/mpeg"
            src={url}
            className='max-w-full max-h-full'
          />
        </audio>
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

export default AudioPreview
