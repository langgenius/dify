import { RiCloseLine } from '@remixicon/react'
import FileImageRender from '../file-image-render'
import type { FileEntity } from '../types'
import { fileIsUploaded } from '../utils'
import Button from '@/app/components/base/button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'

type FileImageItemProps = {
  file: FileEntity
  showDeleteAction?: boolean
  showDownloadAction?: boolean
  onRemove?: (fileId: string) => void
  onReUpload?: (fileId: string) => void
}
const FileImageItem = ({
  file,
  showDeleteAction,
  showDownloadAction,
  onRemove,
  onReUpload,
}: FileImageItemProps) => {
  const { id, progress, base64Url, url } = file

  return (
    <div className='group relative'>
      {
        showDeleteAction && (
          <Button
            className='hidden group-hover:flex absolute -right-1.5 -top-1.5 p-0 w-5 h-5 rounded-full z-10'
            onClick={() => onRemove?.(id)}
          >
            <RiCloseLine className='w-4 h-4 text-components-button-secondary-text' />
          </Button>
        )
      }
      <FileImageRender
        className='w-[68px] h-[68px] shadow-md'
        imageUrl={base64Url || url || ''}
        showDownloadAction={showDownloadAction}
      />
      {
        progress >= 0 && !fileIsUploaded(file) && (
          <div className='absolute inset-0 flex items-center justify-center border-[2px] border-effects-image-frame bg-background-overlay-alt z-10'>
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
          <div className='absolute inset-0 flex items-center justify-center border-[2px] border-state-destructive-border bg-background-overlay-destructive z-10'>
            <ReplayLine
              className='w-5 h-5'
              onClick={() => onReUpload?.(id)}
            />
          </div>
        )
      }
    </div>
  )
}

export default FileImageItem
