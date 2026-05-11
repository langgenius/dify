import type { FC } from 'react'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()

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
        className="inset-0! top-0! left-0! flex h-dvh! max-h-none! w-screen! max-w-none! translate-x-0! translate-y-0! items-center justify-center overflow-hidden! rounded-none! border-none! bg-black/80 p-8! shadow-none!"
        backdropClassName="bg-transparent!"
      >
        <div
          aria-label={title}
          data-testid="video-preview"
          tabIndex={-1}
          onClick={e => e.stopPropagation()}
        >
          <video controls title={title} autoPlay={false} preload="metadata" data-testid="video-element">
            <source
              type="video/mp4"
              src={url}
              className="max-h-full max-w-full"
            />
          </video>
        </div>
        <button
          type="button"
          aria-label={t('operation.close', { ns: 'common' })}
          className="absolute top-6 right-6 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-none bg-white/[0.08] p-0 backdrop-blur-[2px]"
          onClick={onCancel}
        >
          <span className="i-ri-close-line h-4 w-4 text-gray-500" aria-hidden="true" />
        </button>
      </DialogContent>
    </Dialog>
  )
}

export default VideoPreview
