import {
  forwardRef,
  memo,
} from 'react'
import FileListItem from './file-list-item'

const FileListFlexOperation = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div
      ref={ref}
      className='flex flex-wrap gap-2'
    >
      <FileListItem />
      <FileListItem />
      <FileListItem isFile />
      <FileListItem isFile />
      <FileListItem isFile />
      <FileListItem />
      <FileListItem />
      <FileListItem />
      <FileListItem />
    </div>
  )
})
FileListFlexOperation.displayName = 'FileListFlexOperation'

export default memo(FileListFlexOperation)
