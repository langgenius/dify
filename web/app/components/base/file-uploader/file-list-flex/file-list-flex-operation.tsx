import {
  forwardRef,
  memo,
} from 'react'
import { RiCloseLine } from '@remixicon/react'
import { useStore } from '../store'
import { useFile } from '../hooks'
import FileListItem from './file-list-flex-item'
import Button from '@/app/components/base/button'
import ProgressCircle from '@/app/components/base/progress-bar/progress-circle'

const FileListFlexOperation = forwardRef<HTMLDivElement>((_, ref) => {
  const files = useStore(s => s.files)
  const { handleRemoveFile } = useFile()

  return (
    <div
      ref={ref}
      className='flex flex-wrap gap-2'
    >
      {
        files.map(file => (
          <div
            key={file._id}
            className='relative'
          >
            <Button
              className='absolute -right-1.5 -top-1.5 p-0 w-5 h-5 rounded-full z-10'
              onClick={() => handleRemoveFile(file._id)}
            >
              <RiCloseLine className='w-4 h-4 text-components-button-secondary-text' />
            </Button>
            {
              file._progress !== 100 && (
                <div
                  className='absolute inset-0 border-[2px] border-effects-image-frame shadow-md bg-black'
                >
                  <ProgressCircle
                    className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'
                    percentage={file._progress}
                    size={16}
                    circleStrokeColor='stroke-components-progress-white-border'
                    circleFillColor='fill-transparent'
                    sectorFillColor='fill-components-progress-white-progress'
                  />
                </div>
              )
            }
            <FileListItem />
          </div>
        ))
      }
    </div>
  )
})
FileListFlexOperation.displayName = 'FileListFlexOperation'

export default memo(FileListFlexOperation)
