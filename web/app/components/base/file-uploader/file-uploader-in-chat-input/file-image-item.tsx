import type { FileEntity } from '../types'
import { Button } from '@langgenius/dify-ui/button'
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
  const previewSource = base64Url || url
  const downloadSource = url ? `${url}&as_attachment=true` : base64Url

  return (
    <>
      <div className="group/file-image relative">
        {showDeleteAction && (
          <Button
            aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${name}`}
            className="pointer-events-none absolute -top-1.5 -right-1.5 z-11 flex size-5 rounded-full p-0 opacity-0 outline-hidden group-hover/file-image:pointer-events-auto group-hover/file-image:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={(e) => {
              e.stopPropagation()
              onRemove?.(id)
            }}
          >
            <span
              aria-hidden="true"
              className="i-ri-close-line size-4 text-components-button-secondary-text"
            />
          </Button>
        )}
        {canPreview && previewSource ? (
          <button
            type="button"
            className="block cursor-pointer rounded-lg outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            aria-label={`${t(($) => $['operation.view'], { ns: 'common' })} ${name}`}
            onClick={() => setImagePreviewUrl(previewSource)}
          >
            <FileImageRender
              className="h-[68px] w-[68px] shadow-md"
              imageUrl={previewSource}
              alt={name}
              showDownloadAction={showDownloadAction && Boolean(downloadSource)}
            />
          </button>
        ) : (
          <FileImageRender
            className="h-[68px] w-[68px] shadow-md"
            imageUrl={previewSource || ''}
            alt={name}
            showDownloadAction={showDownloadAction && Boolean(downloadSource)}
          />
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
            <button
              type="button"
              aria-label={`${t(($) => $['operation.retry'], { ns: 'common' })} ${name}`}
              className="size-5 rounded-sm border-none bg-transparent p-0 outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={(e) => {
                e.stopPropagation()
                onReUpload?.(id)
              }}
            >
              <span className="i-custom-vender-other-replay-line block size-5" aria-hidden="true" />
            </button>
          </div>
        )}
        {showDownloadAction && downloadSource && (
          <div className="pointer-events-none absolute inset-0.5 z-10 bg-transparent group-hover/file-image:bg-background-overlay-alt">
            <button
              type="button"
              aria-label={`${t(($) => $['operation.download'], { ns: 'common' })} ${name}`}
              className="pointer-events-none absolute right-0.5 bottom-0.5 flex size-6 items-center justify-center rounded-lg border-none bg-components-actionbar-bg p-0 opacity-0 shadow-md outline-hidden group-hover/file-image:pointer-events-auto group-hover/file-image:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={(e) => {
                e.stopPropagation()
                downloadUrl({ url: downloadSource, fileName: name, target: '_blank' })
              }}
            >
              <span className="i-ri-download-line size-4 text-text-tertiary" aria-hidden="true" />
            </button>
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
