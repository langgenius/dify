import {
  forwardRef,
  memo,
} from 'react'
import FileListItem from './file-list-item'

const FileListFlexPreview = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div
      ref={ref}
      className='flex flex-wrap gap-2'
    >
      <FileListItem />
      <FileListItem />
      <FileListItem isFile />
      <FileListItem isFile />
    </div>
  )
})
FileListFlexPreview.displayName = 'FileListFlexPreview'

export default memo(FileListFlexPreview)
