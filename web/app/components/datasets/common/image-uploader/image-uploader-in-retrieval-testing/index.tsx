import {
  FileContextProvider,
} from '../store'
import type { FileEntity } from '../types'
import { useUpload } from '../hooks/use-upload'
import ImageInput from './image-input'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'

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
      <div
        className={cn(
          'flex',
          showUploader ? 'justify-between' : 'justify-end',
          actionAreaClassName,
        )}>
        {showUploader && <ImageInput />}
        {actionButton}
      </div>
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
