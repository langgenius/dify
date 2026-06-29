import type { FileEntity } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { ProgressCircle } from '@langgenius/dify-ui/progress'
import {
  RiCloseLine,
  RiDownloadLine,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import { downloadUrl } from '@/utils/download'
import FileImageRender from '../file-image-render'
import {
  fileIsUploaded,
} from '../utils'

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

  return (
    <>
      <div
        className="group/file-image relative cursor-pointer"
        onClick={() => canPreview && setImagePreviewUrl(base64Url || url || '')}
      >
        {
          showDeleteAction && (
            <Button
              aria-label={t('operation.remove', { ns: 'common' })}
              className="absolute -top-1.5 -right-1.5 z-11 hidden size-5 rounded-full p-0 group-hover/file-image:flex"
              onClick={(e) => {
                e.stopPropagation()
                onRemove?.(id)
              }}
            >
              <RiCloseLine className="size-4 text-components-button-secondary-text" aria-hidden="true" />
            </Button>
          )
        }
        <FileImageRender
          className="h-[68px] w-[68px] shadow-md"
          imageUrl={base64Url || url || ''}
          showDownloadAction={showDownloadAction}
        />
        {
          progress >= 0 && !fileIsUploaded(file) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-effects-image-frame bg-background-overlay-alt">
              <ProgressCircle
                value={progress}
                color="white"
                aria-label={t('uploading', { ns: 'custom' })}
              />
            </div>
          )
        }
        {
          progress === -1 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-state-destructive-border bg-background-overlay-destructive">
              <button
                type="button"
                aria-label={t('operation.retry', { ns: 'common' })}
                className="size-5 border-none bg-transparent p-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onReUpload?.(id)
                }}
              >
                <ReplayLine className="size-5" aria-hidden="true" />
              </button>
            </div>
          )
        }
        {
          showDownloadAction && (
            <div className="absolute inset-0.5 z-10 hidden bg-background-overlay-alt group-hover/file-image:block">
              <button
                type="button"
                aria-label={t('operation.download', { ns: 'common' })}
                className="absolute right-0.5 bottom-0.5 flex size-6 items-center justify-center rounded-lg border-none bg-components-actionbar-bg p-0 shadow-md"
                onClick={(e) => {
                  e.stopPropagation()
                  downloadUrl({ url: download_url || '', fileName: name, target: '_blank' })
                }}
              >
                <RiDownloadLine className="size-4 text-text-tertiary" aria-hidden="true" />
              </button>
            </div>
          )
        }
      </div>
      {
        imagePreviewUrl && canPreview && (
          <ImagePreview
            title={name}
            url={imagePreviewUrl}
            onCancel={() => setImagePreviewUrl('')}
          />
        )
      }
    </>
  )
}

export default FileImageItem
