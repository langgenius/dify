import {
  FileContextProvider,
  useFileStoreWithSelector,
} from '../store'
import type { FileEntity } from '../types'
import FileItem from './image-item'
import { useUpload } from '../hooks/use-upload'
import ImageInput from './image-input'
import cn from '@/utils/classnames'
import { useCallback, useState } from 'react'
import type { ImageInfo } from '@/app/components/datasets/common/image-previewer'
import ImagePreviewer from '@/app/components/datasets/common/image-previewer'

type ImageUploaderInChunkProps = {
  disabled?: boolean
  className?: string
}
const ImageUploaderInChunk = ({
  disabled,
  className,
}: ImageUploaderInChunkProps) => {
  const files = useFileStoreWithSelector(s => s.files)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewImages, setPreviewImages] = useState<ImageInfo[]>([])

  const handleImagePreview = useCallback((fileId: string) => {
    const index = files.findIndex(item => item.id === fileId)
    if (index === -1) return
    setPreviewIndex(index)
    setPreviewImages(files.map(item => ({
      url: item.base64Url || item.sourceUrl || '',
      name: item.name,
      size: item.size,
    })))
  }, [files])

  const handleClosePreview = useCallback(() => {
    setPreviewImages([])
  }, [])

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
              onRemove={handleRemoveFile}
              onReUpload={handleReUploadFile}
              onPreview={handleImagePreview}
            />
          ))
        }
      </div>
      {previewImages.length > 0 && (
        <ImagePreviewer
          images={previewImages}
          initialIndex={previewIndex}
          onClose={handleClosePreview}
        />
      )}
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
      <ImageUploaderInChunk disabled={disabled} className={className} />
    </FileContextProvider>
  )
}

export default ImageUploaderInChunkWrapper
