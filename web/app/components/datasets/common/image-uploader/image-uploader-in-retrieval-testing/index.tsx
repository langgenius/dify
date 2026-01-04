import type { FileEntity } from '../types'
import type { ImageInfo } from '@/app/components/datasets/common/image-previewer'
import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ImagePreviewer from '@/app/components/datasets/common/image-previewer'
import { cn } from '@/utils/classnames'
import { useUpload } from '../hooks/use-upload'
import {
  FileContextProvider,
  useFileStoreWithSelector,
} from '../store'
import ImageInput from './image-input'
import ImageItem from './image-item'

type ImageUploaderInRetrievalTestingProps = {
  textArea: React.ReactNode
  actionButton: React.ReactNode
  showUploader?: boolean
  className?: string
  actionAreaClassName?: string
}
const ImageUploaderInRetrievalTesting = ({
  textArea,
  actionButton,
  showUploader = true,
  className,
  actionAreaClassName,
}: ImageUploaderInRetrievalTestingProps) => {
  const { t } = useTranslation()
  const files = useFileStoreWithSelector(s => s.files)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewImages, setPreviewImages] = useState<ImageInfo[]>([])
  const {
    dragging,
    dragRef,
    dropRef,
    handleRemoveFile,
    handleReUploadFile,
  } = useUpload()

  const handleImagePreview = useCallback((fileId: string) => {
    const index = files.findIndex(item => item.id === fileId)
    if (index === -1)
      return
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

  return (
    <div
      ref={dropRef}
      className={cn('relative flex w-full flex-col', className)}
    >
      {dragging && (
        <div
          className="absolute inset-0.5 z-10 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-components-dropzone-border-accent bg-components-dropzone-bg-accent"
        >
          <div>{t('imageUploader.dropZoneTip', { ns: 'datasetHitTesting' })}</div>
          <div ref={dragRef} className="absolute inset-0" />
        </div>
      )}
      {textArea}
      {
        showUploader && !!files.length && (
          <div className="flex flex-wrap gap-1 bg-background-default px-4 py-2">
            {
              files.map(file => (
                <ImageItem
                  key={file.id}
                  file={file}
                  showDeleteAction
                  onRemove={handleRemoveFile}
                  onReUpload={handleReUploadFile}
                  onPreview={handleImagePreview}
                />
              ))
            }
          </div>
        )
      }
      <div
        className={cn(
          'flex',
          showUploader ? 'justify-between' : 'justify-end',
          actionAreaClassName,
        )}
      >
        {showUploader && <ImageInput />}
        {actionButton}
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

export type ImageUploaderInRetrievalTestingWrapperProps = {
  value?: FileEntity[]
  onChange: (files: FileEntity[]) => void
} & ImageUploaderInRetrievalTestingProps

const ImageUploaderInRetrievalTestingWrapper = ({
  value,
  onChange,
  ...props
}: ImageUploaderInRetrievalTestingWrapperProps) => {
  return (
    <FileContextProvider
      value={value}
      onChange={onChange}
    >
      <ImageUploaderInRetrievalTesting {...props} />
    </FileContextProvider>
  )
}

export default ImageUploaderInRetrievalTestingWrapper
