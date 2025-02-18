import {
  RiCloseLine,
  RiDownloadLine,
} from '@remixicon/react'
import { useState } from 'react'
import {
  downloadFile,
  fileIsUploaded,
  getFileAppearanceType,
  getFileExtension,
} from '../utils'
import FileTypeIcon from '../file-type-icon'
import type { FileEntity } from '../types'
import cn from '@/utils/classnames'
import { formatFileSize } from '@/utils/format'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import PdfPreview from '@/app/components/base/file-uploader/dynamic-pdf-preview'
import AudioPreview from '@/app/components/base/file-uploader/audio-preview'
import VideoPreview from '@/app/components/base/file-uploader/video-preview'

type FileItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  canPreview?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
}
const FileItem = ({
  file,
  showDeleteAction,
  showDownloadAction = true,
  onRemove,
  onReUpload,
  canPreview,
}: FileItemProps) => {
  const { id, name, type, progress, url, base64Url, isRemote } = file
  const [previewUrl, setPreviewUrl] = useState('')
  const ext = getFileExtension(name, type, isRemote)
  const uploadError = progress === -1

  let tmp_preview_url = url || base64Url
  if (!tmp_preview_url && file?.originalFile)
    tmp_preview_url = URL.createObjectURL(file.originalFile.slice()).toString()

  return (
    <>
      <div
        className={cn(
          'group/file-item border-components-panel-border bg-components-card-bg shadow-xs relative h-[68px] w-[144px] rounded-lg border-[0.5px] p-2',
          !uploadError && 'hover:bg-components-card-bg-alt',
          uploadError && 'border-state-destructive-border bg-state-destructive-hover border',
          uploadError && 'hover:border-state-destructive-border bg-state-destructive-hover-alt hover:border-[0.5px]',
        )}
      >
        {
          showDeleteAction && (
            <Button
              className='absolute -right-1.5 -top-1.5 z-[11] hidden h-5 w-5 rounded-full p-0 group-hover/file-item:flex'
              onClick={() => onRemove?.(id)}
            >
              <RiCloseLine className='text-components-button-secondary-text h-4 w-4' />
            </Button>
          )
        }
        <div
          className='system-xs-medium text-text-tertiary mb-1 line-clamp-2 h-8 cursor-pointer break-all'
          title={name}
          onClick={() => canPreview && setPreviewUrl(tmp_preview_url || '')}
        >
          {name}
        </div>
        <div className='relative flex items-center justify-between'>
          <div className='system-2xs-medium-uppercase text-text-tertiary flex items-center'>
            <FileTypeIcon
              size='sm'
              type={getFileAppearanceType(name, type)}
              className='mr-1'
            />
            {
              ext && (
                <>
                  {ext}
                  <div className='mx-1'>·</div>
                </>
              )
            }
            {
              !!file.size && formatFileSize(file.size)
            }
          </div>
          {
            showDownloadAction && tmp_preview_url && (
              <ActionButton
                size='m'
                className='absolute -right-1 -top-1 hidden group-hover/file-item:flex'
                onClick={(e) => {
                  e.stopPropagation()
                  downloadFile(tmp_preview_url || '', name)
                }}
              >
                <RiDownloadLine className='text-text-tertiary h-3.5 w-3.5' />
              </ActionButton>
            )
          }
          {
            progress >= 0 && !fileIsUploaded(file) && (
              <ProgressCircle
                percentage={progress}
                size={12}
                className='shrink-0'
              />
            )
          }
          {
            uploadError && (
              <ReplayLine
                className='text-text-tertiary h-4 w-4'
                onClick={() => onReUpload?.(id)}
              />
            )
          }
        </div>
      </div>
      {
        type.split('/')[0] === 'audio' && canPreview && previewUrl && (
          <AudioPreview
            title={name}
            url={previewUrl}
            onCancel={() => setPreviewUrl('')}
          />
        )
      }
      {
        type.split('/')[0] === 'video' && canPreview && previewUrl && (
          <VideoPreview
            title={name}
            url={previewUrl}
            onCancel={() => setPreviewUrl('')}
          />
        )
      }
      {
        type.split('/')[1] === 'pdf' && canPreview && previewUrl && (
          <PdfPreview url={previewUrl} onCancel={() => { setPreviewUrl('') }} />
        )
      }
    </>
  )
}

export default FileItem
