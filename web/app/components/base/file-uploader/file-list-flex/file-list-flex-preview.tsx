import {
  forwardRef,
  memo,
} from 'react'
import FileListFlexItem from './file-list-flex-item'

const FileListFlexPreview = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div
      ref={ref}
      className='flex flex-wrap gap-2'
    >
      <FileListFlexItem />
      <FileListFlexItem />
      <FileListFlexItem isFile />
      <FileListFlexItem isFile />
    </div>
  )
})
FileListFlexPreview.displayName = 'FileListFlexPreview'

export default memo(FileListFlexPreview)
