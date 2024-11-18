import {
  memo,
} from 'react'
import {
  RiDeleteBinLine,
  RiDownloadLine,
} from '@remixicon/react'
import FileTypeIcon from '../file-type-icon'
import {
  fileIsUploaded,
  getFileAppearanceType,
  getFileExtension,
} from '../utils'
import FileImageRender from '../file-image-render'
import type { FileEntity } from '../types'
import ActionButton from '@/app/components/base/action-button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { formatFileSize } from '@/utils/format'
import cn from '@/utils/classnames'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'

type FileInAttachmentItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
}
const FileInAttachmentItem = ({
  file,
  showDeleteAction,
  showDownloadAction = true,
  onRemove,
  onReUpload,
}: FileInAttachmentItemProps) => {
  const { id, name, type, progress, supportFileType, base64Url, url, isRemote } = file
  const ext = getFileExtension(name, type, isRemote)
  const isImageFile = supportFileType === SupportUploadFileTypes.image

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
              imageUrl={base64Url || url || ''}
            />
          )
        }
        {
          !isImageFile && (
            <FileTypeIcon
              type={getFileAppearanceType(name, type)}
              size='lg'
            />
          )
        }
      </div>
      <div className='grow w-0 mr-1'>
        <div
          className='flex items-center mb-0.5 system-xs-medium text-text-secondary truncate'
          title={file.name}
        >
          <div className='truncate'>{name}</div>
        </div>
        <div className='flex items-center system-2xs-medium-uppercase text-text-tertiary'>
          {
            ext && (
              <span>{ext.toLowerCase()}</span>
            )
          }
          {
            ext && (
              <span className='mx-1 system-2xs-medium'>•</span>
            )
          }
          {
            !!file.size && (
              <span>{formatFileSize(file.size)}</span>
            )
          }
        </div>
      </div>
      <div className='shrink-0 flex items-center'>
        {
          progress >= 0 && !fileIsUploaded(file) && (
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
              onClick={() => onReUpload?.(id)}
            >
              <ReplayLine className='w-4 h-4 text-text-tertiary' />
            </ActionButton>
          )
        }
        {
          showDeleteAction && (
            <ActionButton onClick={() => onRemove?.(id)}>
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
