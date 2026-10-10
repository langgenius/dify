import type { FileEntity } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { ImagePreviewer } from '@/app/components/datasets/common/image-previewer'
import { useUpload } from '../hooks/use-upload'
import { FileContextProvider, useFileStoreWithSelector } from '../store'
import ImageInput from './image-input'
import { ImageItem } from './image-item'

type ImageUploaderInRetrievalTestingProps = {
  textArea: React.ReactNode
  actionButton: React.ReactNode
  showUploader?: boolean
  className?: string
  actionAreaClassName?: string
}
const ImageUploaderInRetrievalTestingContent = ({
  textArea,
  actionButton,
  showUploader = true,
  className,
  actionAreaClassName,
}: ImageUploaderInRetrievalTestingProps) => {
  const { t } = useTranslation(['datasetHitTesting'])
  const files = useFileStoreWithSelector((s) => s.files)
  const { dragging, dragRef, dropRef, handleRemoveFile, handleReUploadFile } = useUpload()

  const previewFiles = files.filter((file) => file.base64Url || file.sourceUrl)
  const previewImages = previewFiles.map((file) => ({
    url: file.base64Url || file.sourceUrl || '',
    name: file.name,
    size: file.size,
  }))

  return (
    <ImagePreviewer>
      <div ref={dropRef} className={cn('relative flex w-full flex-col', className)}>
        {dragging && (
          <div className="absolute inset-0.5 z-10 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-components-dropzone-border-accent bg-components-dropzone-bg-accent">
            <div>{t(($) => $['imageUploader.dropZoneTip'], { ns: 'datasetHitTesting' })}</div>
            <div ref={dragRef} className="absolute inset-0" />
          </div>
        )}
        {textArea}
        {showUploader && !!files.length && (
          <div className="flex flex-wrap gap-1 bg-background-default px-4 py-2">
            {files.map((file) => (
              <ImageItem
                key={file.id}
                file={file}
                showDeleteAction
                onRemove={handleRemoveFile}
                onReUpload={handleReUploadFile}
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
        )}
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
      </div>
    </ImagePreviewer>
  )
}

type ImageUploaderInRetrievalTestingWrapperProps = {
  value?: FileEntity[]
  onChange: (files: FileEntity[]) => void
} & ImageUploaderInRetrievalTestingProps

export function ImageUploaderInRetrievalTesting({
  value,
  onChange,
  ...props
}: ImageUploaderInRetrievalTestingWrapperProps) {
  return (
    <FileContextProvider value={value} onChange={onChange}>
      <ImageUploaderInRetrievalTestingContent {...props} />
    </FileContextProvider>
  )
}
