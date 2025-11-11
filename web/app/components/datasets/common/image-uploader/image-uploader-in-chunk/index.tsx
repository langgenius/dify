import {
  FileContextProvider,
  useFileStoreWithSelector,
} from '../store'
import type { FileEntity } from '../types'
import FileItem from './image-item'
import { useUpload } from '../hooks/use-upload'
import ImageInput from '../image-input'
import cn from '@/utils/classnames'

type FileUploaderInAttachmentProps = {
  disabled?: boolean
  className?: string
}
const FileUploaderInAttachment = ({
  disabled,
  className,
}: FileUploaderInAttachmentProps) => {
  const files = useFileStoreWithSelector(s => s.files)
  const {
    handleRemoveFile,
    handleReUploadFile,
  } = useUpload()

  return (
    <div className={cn('w-full', className)}>
      <ImageInput />
      <div className='mt-1 flex flex-wrap gap-2'>
        {
          files.map(file => (
            <FileItem
              key={file.id}
              file={file}
              showDeleteAction={!disabled}
              onRemove={() => handleRemoveFile(file.id)}
              onReUpload={() => handleReUploadFile(file.id)}
            />
          ))
        }
      </div>
    </div>
  )
}

export type ImageUploaderInChunkWrapperProps = {
  value?: FileEntity[]
  onChange: (files: FileEntity[]) => void
  disabled?: boolean
  className?: string
}

const ImageUploaderInChunkWrapper = ({
  value,
  onChange,
  disabled,
  className,
}: ImageUploaderInChunkWrapperProps) => {
  return (
    <FileContextProvider
      value={value}
      onChange={onChange}
    >
      <FileUploaderInAttachment disabled={disabled} className={className} />
    </FileContextProvider>
  )
}

export default ImageUploaderInChunkWrapper
