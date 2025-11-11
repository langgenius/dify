import {
  FileContextProvider,
} from '../store'
import type { FileEntity } from '../types'
import { useUpload } from '../hooks/use-upload'
import ImageInput from './image-input'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

type FileUploaderInRetrievalTestingProps = {
  textArea: React.ReactNode
  actionButton: React.ReactNode
  className?: string
  actionAreaClassName?: string
}
const FileUploaderInRetrievalTesting = ({
  textArea,
  actionButton,
  className,
  actionAreaClassName,
}: FileUploaderInRetrievalTestingProps) => {
  const { t } = useTranslation()
  const {
    dragging,
    dragRef,
    dropRef,
  } = useUpload()

  return (
    <div
      ref={dropRef}
      className={cn('relative flex w-full flex-col', className)}
    >
      {dragging && (
        <div
          className='absolute inset-0.5 z-10 flex items-center justify-center rounded-lg border-[1.5px] border-dashed border-components-dropzone-border-accent bg-components-dropzone-bg-accent'
        >
          <div>{t('datasetHitTesting.imageUploader.dropZoneTip')}</div>
          <div ref={dragRef} className='absolute inset-0' />
        </div>
      )}
      {textArea}
      <div className={cn('flex justify-between', actionAreaClassName)}>
        <ImageInput />
        {actionButton}
      </div>
    </div>
  )
}

export type ImageUploaderInRetrievalTestingWrapperProps = {
  value?: FileEntity[]
  onChange: (files: FileEntity[]) => void
  textArea: React.ReactNode
  actionButton: React.ReactNode
  className?: string
  actionAreaClassName?: string
}

const ImageUploaderInRetrievalTestingWrapper = ({
  value,
  onChange,
  textArea,
  actionButton,
  className,
  actionAreaClassName,
}: ImageUploaderInRetrievalTestingWrapperProps) => {
  return (
    <FileContextProvider
      value={value}
      onChange={onChange}
    >
      <FileUploaderInRetrievalTesting
        textArea={textArea}
        actionButton={actionButton}
        className={className}
        actionAreaClassName={actionAreaClassName}
      />
    </FileContextProvider>
  )
}

export default ImageUploaderInRetrievalTestingWrapper
