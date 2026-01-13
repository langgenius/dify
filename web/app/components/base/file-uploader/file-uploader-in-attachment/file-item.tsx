import type { FileEntity } from '../types'
import {
  RiDeleteBinLine,
  RiDownloadLine,
  RiEyeLine,
} from '@remixicon/react'
import {
  memo,
  useState,
} from 'react'
import ActionButton from '@/app/components/base/action-button'
import { PreviewMode } from '@/app/components/base/features/types'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import { formatFileSize } from '@/utils/format'
import FileImageRender from '../file-image-render'
import FileTypeIcon from '../file-type-icon'
import {
  downloadFile,
  fileIsUploaded,
  getFileAppearanceType,
  getFileExtension,
} from '../utils'

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
  const { id, name, type, progress, supportFileType, base64Url, url, isRemote } = file
  const ext = getFileExtension(name, type, isRemote)
  const isImageFile = supportFileType === SupportUploadFileTypes.image
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  return (
    <>
      <div
        className={cn(
          'flex h-12 items-center rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pr-3 shadow-xs',
          progress === -1 && 'border-state-destructive-border bg-state-destructive-hover',
          canPreview && previewMode === PreviewMode.NewPage && 'cursor-pointer',
        )}
        onClick={() => {
          if (canPreview && previewMode === PreviewMode.NewPage)
            window.open(url || base64Url || '', '_blank')
        }}
      >
        <div className="flex h-12 w-12 items-center justify-center">
          {
            isImageFile && (
              <FileImageRender
                className="h-8 w-8"
                imageUrl={base64Url || url || ''}
              />
            )
          }
          {
            !isImageFile && (
              <FileTypeIcon
                type={getFileAppearanceType(name, type)}
                size="xl"
              />
            )
          }
        </div>
        <div className="mr-1 w-0 grow">
          <div
            className="system-xs-medium mb-0.5 flex items-center truncate text-text-secondary"
            title={file.name}
          >
            <div className="truncate">{name}</div>
          </div>
          <div className="system-2xs-medium-uppercase flex items-center text-text-tertiary">
            {
              ext && (
                <span>{ext.toLowerCase()}</span>
              )
            }
            {
              ext && (
                <span className="system-2xs-medium mx-1">•</span>
              )
            }
            {
              !!file.size && (
                <span>{formatFileSize(file.size)}</span>
              )
            }
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {
            progress >= 0 && !fileIsUploaded(file) && (
              <ProgressCircle
                className="mr-2.5"
                percentage={progress}
              />
            )
          }
          {
            progress === -1 && (
              <ActionButton
                className="mr-1"
                onClick={() => onReUpload?.(id)}
              >
                <ReplayLine className="h-4 w-4 text-text-tertiary" />
              </ActionButton>
            )
          }
          {
            showDeleteAction && (
              <ActionButton onClick={() => onRemove?.(id)}>
                <RiDeleteBinLine className="h-4 w-4" />
              </ActionButton>
            )
          }
          {
            canPreview && isImageFile && (
              <ActionButton className="mr-1" onClick={() => setImagePreviewUrl(url || '')}>
                <RiEyeLine className="h-4 w-4" />
              </ActionButton>
            )
          }
          {
            showDownloadAction && (
              <ActionButton onClick={(e) => {
                e.stopPropagation()
                downloadFile(url || base64Url || '', name)
              }}
              >
                <RiDownloadLine className="h-4 w-4" />
              </ActionButton>
            )
          }
        </div>
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

export default memo(FileInAttachmentItem)
