import { isImage } from '../utils'
import { useStore } from '../store'
import FileImageItem from './file-image-item'
import FileItem from './file-item'

const FileList = () => {
  const files = useStore(s => s.files)

  return (
    <div className='flex flex-wrap gap-2'>
      {
        files.map((file) => {
          if (isImage(file.file)) {
            return (
              <FileImageItem
                key={file.id}
                file={file}
              />
            )
          }

          return (
            <FileItem
              key={file.id}
              file={file}
            />
          )
        })
      }
    </div>
  )
}

export default FileList
