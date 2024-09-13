import { RiCloseLine } from '@remixicon/react'
import FileImageRender from '../file-image-render'
import type { FileEntity } from '../types'
import { useFile } from '../hooks'
import Button from '@/app/components/base/button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'
import { ReplayLine } from '@/app/components/base/icons/src/vender/other'

type FileImageItemProps = {
  file: FileEntity
  className?: string
}
const FileImageItem = ({
  file,
}: FileImageItemProps) => {
  const { handleRemoveFile } = useFile()

  return (
    <div className='group relative'>
      <Button
        className='hidden group-hover:flex absolute -right-1.5 -top-1.5 p-0 w-5 h-5 rounded-full z-10'
        onClick={() => handleRemoveFile(file.id)}
      >
        <RiCloseLine className='w-4 h-4 text-components-button-secondary-text' />
      </Button>
      <FileImageRender
        className='w-[68px] h-[68px] shadow-md'
        imageUrl={file.base64Url || ''}
      />
      {
        file.progress > 0 && file.progress < 100 && (
          <div className='absolute inset-0 flex items-center justify-center border-[2px] border-effects-image-frame bg-background-overlay-alt'>
            <ProgressCircle
              percentage={file.progress}
              size={12}
              circleStrokeColor='stroke-components-progress-white-border'
              circleFillColor='fill-transparent'
              sectorFillColor='fill-components-progress-white-progress'
            />
          </div>
        )
      }
      {
        file.progress === -1 && (
          <div className='absolute inset-0 flex items-center justify-center border-[2px] border-state-destructive-border bg-background-overlay-destructive'>
            <ReplayLine className='w-5 h-5' />
          </div>
        )
      }
    </div>
  )
}

export default FileImageItem
