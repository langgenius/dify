import type { FileEntity } from '../types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { downloadUrl } from '@/utils/download'
import FileImageRender from '../file-image-render'
import { fileIsUploaded } from '../utils'

type FileImageItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  canPreview?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
}
const FileImageItem = ({
  file,
  showDeleteAction,
  showDownloadAction,
  canPreview,
  onRemove,
  onReUpload,
}: FileImageItemProps) => {
  const { t } = useTranslation()
  const { id, progress, base64Url, url, name } = file
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const download_url = url ? `${url}&as_attachment=true` : base64Url
  const image = (
    <FileImageRender
      className="h-17 w-17 shadow-md"
      imageUrl={base64Url || url || ''}
      showDownloadAction={showDownloadAction}
    />
  )

  return (
    <>
      <div className="group/file-image relative">
        {canPreview ? (
          <button
            type="button"
            aria-label={`${t(($) => $['operation.view'], { ns: 'common' })} ${name}`}
            className="block border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            onClick={() => setImagePreviewUrl(base64Url || url || '')}
          >
            {image}
          </button>
        ) : (
          image
        )}
        {showDeleteAction && (
          <IconButton
            aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
            variant="secondary"
            size="sm"
            className="pointer-events-none absolute -top-1.5 -right-1.5 z-11 rounded-full opacity-0 group-focus-within/file-image:pointer-events-auto group-focus-within/file-image:opacity-100 group-hover/file-image:pointer-events-auto group-hover/file-image:opacity-100"
            onClick={() => onRemove?.(id)}
          >
            <span
              aria-hidden="true"
              className="i-ri-close-line size-4 text-components-button-secondary-text"
            />
          </IconButton>
        )}
        {progress >= 0 && !fileIsUploaded(file) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-effects-image-frame bg-background-overlay-alt">
            <ProgressCircle
              value={progress}
              color="white"
              aria-label={t(($) => $.uploading, { ns: 'custom' })}
            />
          </div>
        )}
        {progress === -1 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-state-destructive-border bg-background-overlay-destructive">
            <IconButton
              size="sm"
              aria-label={t(($) => $['operation.retry'], { ns: 'common' })}
              className="rounded-none hover:bg-transparent"
              onClick={() => onReUpload?.(id)}
            >
              <span aria-hidden="true" className="i-custom-vender-other-replay-line size-5" />
            </IconButton>
          </div>
        )}
        {showDownloadAction && (
          <div className="pointer-events-none absolute inset-0.5 z-10 bg-background-overlay-alt opacity-0 group-focus-within/file-image:opacity-100 group-hover/file-image:opacity-100">
            <IconButton
              size="md"
              aria-label={t(($) => $['operation.download'], { ns: 'common' })}
              className="pointer-events-none absolute right-0.5 bottom-0.5 rounded-lg bg-components-actionbar-bg shadow-md group-focus-within/file-image:pointer-events-auto group-hover/file-image:pointer-events-auto hover:bg-components-actionbar-bg"
              onClick={() => {
                downloadUrl({ url: download_url || '', fileName: name, target: '_blank' })
              }}
            >
              <span aria-hidden="true" className="i-ri-download-line size-4 text-text-tertiary" />
            </IconButton>
          </div>
        )}
      </div>
      {imagePreviewUrl && canPreview && (
        <ImagePreview title={name} url={imagePreviewUrl} onCancel={() => setImagePreviewUrl('')} />
      )}
    </>
  )
}

export default FileImageItem
