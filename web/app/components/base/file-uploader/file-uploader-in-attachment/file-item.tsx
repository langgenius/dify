import type { FileEntity } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { PreviewMode } from '@/app/components/base/features/types'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { downloadUrl } from '@/utils/download'
import { formatFileSize } from '@/utils/format'
import FileImageRender from '../file-image-render'
import FileTypeIcon from '../file-type-icon'
import { fileIsUploaded, getFileAppearanceType, getFileExtension } from '../utils'

type FileInAttachmentItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
  canPreview?: boolean
  previewMode?: PreviewMode
}
const FileInAttachmentItem = ({
  file,
  showDeleteAction,
  showDownloadAction = true,
  onRemove,
  onReUpload,
  canPreview,
  previewMode = PreviewMode.CurrentPage,
}: FileInAttachmentItemProps) => {
  const { t } = useTranslation()
  const { id, name, type, progress, supportFileType, base64Url, url, isRemote } = file
  const ext = getFileExtension(name, type, isRemote)
  const isImageFile = supportFileType === SupportUploadFileTypes.image
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const downloadSource = url || base64Url
  const imagePreviewSource = base64Url || url
  const canOpenInNewPage = Boolean(
    canPreview && previewMode === PreviewMode.NewPage && downloadSource,
  )
  const canOpenImagePreview = Boolean(canPreview && isImageFile && imagePreviewSource)
  const fileSummary = (
    <>
      <div className="flex size-12 items-center justify-center">
        {isImageFile && (
          <FileImageRender className="size-8" imageUrl={imagePreviewSource || ''} alt={name} />
        )}
        {!isImageFile && <FileTypeIcon type={getFileAppearanceType(name, type)} size="xl" />}
      </div>
      <div className="mr-1 w-0 grow">
        <div
          className="mb-0.5 flex items-center truncate system-xs-medium text-text-secondary"
          title={file.name}
        >
          <div className="truncate">{name}</div>
        </div>
        <div className="flex items-center system-2xs-medium-uppercase text-text-tertiary">
          {ext && <span>{ext.toLowerCase()}</span>}
          {ext && <span className="mx-1 system-2xs-medium">•</span>}
          {!!file.size && <span>{formatFileSize(file.size)}</span>}
        </div>
      </div>
    </>
  )

  return (
    <>
      <div
        className={cn(
          'flex h-12 items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pr-3 shadow-xs',
          progress === -1 && 'border-state-destructive-border bg-state-destructive-hover',
        )}
      >
        {canOpenInNewPage ? (
          <button
            type="button"
            className="flex min-w-0 grow cursor-pointer items-center rounded-lg text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            aria-label={`${t(($) => $['operation.openInNewTab'], { ns: 'common' })} ${name}`}
            onClick={() => window.open(downloadSource, '_blank')}
          >
            {fileSummary}
          </button>
        ) : (
          <div className="flex min-w-0 grow items-center">{fileSummary}</div>
        )}
        <div className="flex shrink-0 items-center">
          {progress >= 0 && !fileIsUploaded(file) && (
            <ProgressCircle
              className="mr-2.5"
              value={progress}
              aria-label={t(($) => $.uploading, { ns: 'custom' })}
            />
          )}
          {progress === -1 && (
            <ActionButton
              className="mr-1"
              aria-label={`${t(($) => $['operation.retry'], { ns: 'common' })} ${name}`}
              onClick={() => onReUpload?.(id)}
            >
              <span
                className="i-custom-vender-other-replay-line size-4 text-text-tertiary"
                aria-hidden="true"
              />
            </ActionButton>
          )}
          {showDeleteAction && (
            <ActionButton
              aria-label={`${t(($) => $['operation.remove'], { ns: 'common' })} ${name}`}
              onClick={() => onRemove?.(id)}
            >
              <span className="i-ri-delete-bin-line size-4" aria-hidden="true" />
            </ActionButton>
          )}
          {canOpenImagePreview && (
            <ActionButton
              className="mr-1"
              aria-label={`${t(($) => $['operation.view'], { ns: 'common' })} ${name}`}
              onClick={() => setImagePreviewUrl(imagePreviewSource || '')}
            >
              <span className="i-ri-eye-line size-4" aria-hidden="true" />
            </ActionButton>
          )}
          {showDownloadAction && downloadSource && (
            <ActionButton
              aria-label={`${t(($) => $['operation.download'], { ns: 'common' })} ${name}`}
              onClick={(e) => {
                e.stopPropagation()
                downloadUrl({ url: downloadSource, fileName: name, target: '_blank' })
              }}
            >
              <span className="i-ri-download-line size-4" aria-hidden="true" />
            </ActionButton>
          )}
        </div>
      </div>
      {imagePreviewUrl && canPreview && (
        <ImagePreview title={name} url={imagePreviewUrl} onCancel={() => setImagePreviewUrl('')} />
      )}
    </>
  )
}

export default memo(FileInAttachmentItem)
