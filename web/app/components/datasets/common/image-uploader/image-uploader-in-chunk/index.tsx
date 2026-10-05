import type { FileEntity } from '../types'
import type { ImagePreviewPayload } from '@/app/components/datasets/common/image-previewer'
import { cn } from '@langgenius/dify-ui/cn'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { ImagePreviewer } from '@/app/components/datasets/common/image-previewer'
import { useUpload } from '../hooks/use-upload'
import { FileContextProvider, useFileStoreWithSelector } from '../store'
import ImageInput from './image-input'
import { ImageItem } from './image-item'

type ImageUploaderInChunkProps = {
  disabled?: boolean
  className?: string
}
const ImageUploaderInChunkContent = ({ disabled, className }: ImageUploaderInChunkProps) => {
  const files = useFileStoreWithSelector((s) => s.files)
  const [previewHandle] = useState(createDialogHandle<ImagePreviewPayload>)

  const previewFiles = files.filter((file) => file.base64Url || file.sourceUrl)
  const previewImages = previewFiles.map((file) => ({
    url: file.base64Url || file.sourceUrl || '',
    name: file.name,
    size: file.size,
  }))

  const { handleRemoveFile, handleReUploadFile } = useUpload()

  return (
    <div className={cn('w-full', className)}>
      {!disabled && <ImageInput />}
      <div className="flex flex-wrap gap-2 py-1">
        {files.map((file) => (
          <ImageItem
            key={file.id}
            file={file}
            showDeleteAction={!disabled}
            disabled={disabled}
            onRemove={handleRemoveFile}
            onReUpload={handleReUploadFile}
            previewHandle={previewHandle}
            previewPayload={
              file.base64Url || file.sourceUrl
                ? {
                    images: previewImages,
                    initialIndex: previewFiles.findIndex((item) => item.id === file.id),
                  }
                : undefined
            }
          />
        ))}
      </div>
      <ImagePreviewer handle={previewHandle} />
    </div>
  )
}

type ImageUploaderInChunkWrapperProps = {
  value?: FileEntity[]
  onChange: (files: FileEntity[]) => void
} & ImageUploaderInChunkProps

export function ImageUploaderInChunk({
  value,
  onChange,
  ...props
}: ImageUploaderInChunkWrapperProps) {
  return (
    <FileContextProvider value={value} onChange={onChange}>
      <ImageUploaderInChunkContent {...props} />
    </FileContextProvider>
  )
}
