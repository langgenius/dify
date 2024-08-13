import {
  forwardRef,
  memo,
} from 'react'
import { RiCloseLine } from '@remixicon/react'
import { useStore } from '../store'
import FileListItem from './file-list-flex-item'
import Button from '@/app/components/base/button'

const FileListFlexOperation = forwardRef<HTMLDivElement>((_, ref) => {
  const files = useStore(s => s.files)

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
            <Button className='absolute -right-1.5 -top-1.5 p-0 w-5 h-5 rounded-full'>
              <RiCloseLine className='w-4 h-4 text-components-button-secondary-text' />
            </Button>
            <FileListItem />
          </div>
        ))
      }
    </div>
  )
})
FileListFlexOperation.displayName = 'FileListFlexOperation'

export default memo(FileListFlexOperation)
