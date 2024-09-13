import { memo } from 'react'
import { RiDeleteBinLine } from '@remixicon/react'
import FileTypeIcon from '../file-type-icon'
import type { FileEntity } from '../types'
import { useFile } from '../hooks'
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
  file: FileEntity
}
const FileInAttachmentItem = ({
  file,
}: FileInAttachmentItemProps) => {
  const {
    handleRemoveFile,
    handleReUploadFile,
  } = useFile()
  const ext = getFileExtension(file.file)

  return (
    <div className={cn(
      'flex items-center pr-3 h-12 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs',
      file.progress === -1 && 'bg-state-destructive-hover border-state-destructive-border',
    )}>
      <div className='flex items-center justify-center w-12 h-12'>
        {
          isImage(file?.file) && (
            <FileImageRender
              className='w-8 h-8'
              imageUrl={file.base64Url || ''}
            />
          )
        }
        {
          !isImage(file.file) && (
            <FileTypeIcon
              type={getFileAppearanceType(file?.file)}
              size='lg'
            />
          )
        }
      </div>
      <div className='grow w-0'>
        <div
          className='mb-0.5 system-xs-medium text-text-secondary truncate'
          title={file.file?.name}
        >
          {file.file?.name}
        </div>
        <div className='flex items-center system-2xs-medium-uppercase text-text-tertiary'>
          {
            ext && (
              <span>{ext.toLowerCase()}</span>
            )
          }
          <span className='mx-1 system-2xs-medium'>•</span>
          <span>{formatFileSize(file.file?.size || 0)}</span>
        </div>
      </div>
      <div className='shrink-0 flex items-center'>
        {
          file.progress >= 0 && file.progress < 100 && (
            <ProgressCircle
              className='mr-2.5'
              percentage={file.progress}
            />
          )
        }
        {
          file.progress === -1 && (
            <ActionButton
              className='mr-1'
              onClick={() => handleReUploadFile(file.id)}
            >
              <ReplayLine className='w-4 h-4 text-text-tertiary' />
            </ActionButton>
          )
        }
        <ActionButton onClick={() => handleRemoveFile(file.id)}>
          <RiDeleteBinLine className='w-4 h-4' />
        </ActionButton>
      </div>
    </div>
  )
}

export default memo(FileInAttachmentItem)
