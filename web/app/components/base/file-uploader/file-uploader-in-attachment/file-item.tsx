import { memo } from 'react'
import {
  RiDeleteBinLine,
  RiDownloadLine,
} from '@remixicon/react'
import FileTypeIcon from '../file-type-icon'
import {
  getFileAppearanceType,
  getFileExtension,
  isImage,
} from '../utils'
import FileImageRender from '../file-image-render'
import ActionButton from '@/app/components/base/action-button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { formatFileSize } from '@/utils/format'
import cn from '@/utils/classnames'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'

type FileInAttachmentItemProps = {
  fileId: string
  file: File
  imageUrl?: string
  progress?: number
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
}
const FileInAttachmentItem = ({
  fileId,
  file,
  imageUrl,
  progress = 0,
  showDeleteAction,
  showDownloadAction = true,
  onRemove,
  onReUpload,
}: FileInAttachmentItemProps) => {
  const isImageFile = isImage(file)
  const ext = getFileExtension(file)

  return (
    <div className={cn(
      'flex items-center pr-3 h-12 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs',
      progress === -1 && 'bg-state-destructive-hover border-state-destructive-border',
    )}>
      <div className='flex items-center justify-center w-12 h-12'>
        {
          isImageFile && (
            <FileImageRender
              className='w-8 h-8'
              imageUrl={imageUrl || ''}
            />
          )
        }
        {
          !isImageFile && (
            <FileTypeIcon
              type={getFileAppearanceType(file)}
              size='lg'
            />
          )
        }
      </div>
      <div className='grow w-0'>
        <div
          className='mb-0.5 system-xs-medium text-text-secondary truncate'
          title={file.name}
        >
          {file.name}
        </div>
        <div className='flex items-center system-2xs-medium-uppercase text-text-tertiary'>
          {
            ext && (
              <span>{ext.toLowerCase()}</span>
            )
          }
          <span className='mx-1 system-2xs-medium'>•</span>
          <span>{formatFileSize(file.size || 0)}</span>
        </div>
      </div>
      <div className='shrink-0 flex items-center'>
        {
          progress > 0 && progress < 100 && (
            <ProgressCircle
              className='mr-2.5'
              percentage={progress}
            />
          )
        }
        {
          progress === -1 && (
            <ActionButton
              className='mr-1'
              onClick={() => onReUpload?.(fileId)}
            >
              <ReplayLine className='w-4 h-4 text-text-tertiary' />
            </ActionButton>
          )
        }
        {
          showDeleteAction && (
            <ActionButton onClick={() => onRemove?.(fileId)}>
              <RiDeleteBinLine className='w-4 h-4' />
            </ActionButton>
          )
        }
        {
          showDownloadAction && (
            <ActionButton
              size='xs'
            >
              <RiDownloadLine className='w-3.5 h-3.5 text-text-tertiary' />
            </ActionButton>
          )
        }
      </div>
    </div>
  )
}

export default memo(FileInAttachmentItem)
