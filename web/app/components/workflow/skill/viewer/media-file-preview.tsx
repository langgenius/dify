import * as React from 'react'
import { useTranslation } from 'react-i18next'

type MediaFilePreviewProps = {
  type: 'image' | 'video'
  src: string
}

const MediaFilePreview = ({ type, src }: MediaFilePreviewProps) => {
  const { t } = useTranslation('workflow')

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center text-text-tertiary">
        <span className="system-sm-regular">
          {t('skillEditor.previewUnavailable')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      {type === 'image' && (
        <img
          src={src}
          alt=""
          className="max-h-full max-w-full object-contain"
        />
      )}
      {type === 'video' && (
        <video
          src={src}
          controls
          className="max-h-full max-w-full"
        />
      )}
    </div>
  )
}

export default React.memo(MediaFilePreview)
