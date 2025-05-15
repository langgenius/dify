import { useState } from 'react'
import {
  RiCloseLine,
  RiDownloadLine,
} from '@remixicon/react'
import FileImageRender from '../file-image-render'
import type { FileEntity } from '../types'
import {
  downloadFile,
  fileIsUploaded,
} from '../utils'
import Button from '@/app/components/base/button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

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
  const { id, progress, base64Url, url, name } = file
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')
  const download_url = url ? `${url}&as_attachment=true` : base64Url

  return (
    <>
      <div
        className='group/file-image relative cursor-pointer'
        onClick={() => canPreview && setImagePreviewUrl(base64Url || url || '')}
      >
        {
          showDeleteAction && (
            <Button
              className='absolute -right-1.5 -top-1.5 z-[11] hidden h-5 w-5 rounded-full p-0 group-hover/file-image:flex'
              onClick={() => onRemove?.(id)}
            >
              <RiCloseLine className='h-4 w-4 text-components-button-secondary-text' />
            </Button>
          )
        }
        <FileImageRender
          className='h-[68px] w-[68px] shadow-md'
          imageUrl={base64Url || url || ''}
          showDownloadAction={showDownloadAction}
        />
        {
          progress >= 0 && !fileIsUploaded(file) && (
            <div className='absolute inset-0 z-10 flex items-center justify-center border-[2px] border-effects-image-frame bg-background-overlay-alt'>
              <ProgressCircle
                percentage={progress}
                size={12}
                circleStrokeColor='stroke-components-progress-white-border'
                circleFillColor='fill-transparent'
                sectorFillColor='fill-components-progress-white-progress'
              />
            </div>
          )
        }
        {
          progress === -1 && (
            <div className='absolute inset-0 z-10 flex items-center justify-center border-[2px] border-state-destructive-border bg-background-overlay-destructive'>
              <ReplayLine
                className='h-5 w-5'
                onClick={() => onReUpload?.(id)}
              />
            </div>
          )
        }
        {
          showDownloadAction && (
            <div className='absolute inset-0.5 z-10 hidden bg-background-overlay-alt bg-opacity-[0.3] group-hover/file-image:block'>
              <div
                className='absolute bottom-0.5 right-0.5  flex h-6 w-6 items-center justify-center rounded-lg bg-components-actionbar-bg shadow-md'
                onClick={(e) => {
                  e.stopPropagation()
                  downloadFile(download_url || '', name)
                }}
              >
                <RiDownloadLine className='h-4 w-4 text-text-tertiary' />
              </div>
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
