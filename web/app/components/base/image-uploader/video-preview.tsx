import type { FC } from 'react'
import { createPortal } from 'react-dom'

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
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-8" onClick={e => e.stopPropagation()} data-testid="video-preview">
      <div>
        <video controls title={title} autoPlay={false} preload="metadata" data-testid="video-element">
          <source
            type="video/mp4"
            src={url}
            className="max-h-full max-w-full"
          />
        </video>
      </div>
      <div
        className="absolute right-6 top-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-white/[0.08] backdrop-blur-[2px]"
        onClick={onCancel}
      >
        <span className="i-ri-close-line h-4 w-4 text-gray-500" data-testid="close-button" />
      </div>
    </div>,
    document.body,
  )
}

export default VideoPreview
