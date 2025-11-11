import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpload } from '../hooks/use-upload'
import { ACCEPT_TYPES } from '../constants'
import { useFileStoreWithSelector } from '../store'
import ImageItem from './image-item'
import { RiImageAddLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import type { ImageInfo } from '@/app/components/datasets/common/image-previewer'
import ImagePreviewer from '@/app/components/datasets/common/image-previewer'

const ImageUploader = () => {
  const { t } = useTranslation()
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
    fileUploadConfig,
    uploaderRef,
    fileChangeHandle,
    selectHandle,
    handleRemoveFile,
    handleReUploadFile,
  } = useUpload()

  return (
    <div>
      <input
        ref={uploaderRef}
        id='fileUploader'
        className='hidden'
        type='file'
        multiple
        accept={ACCEPT_TYPES.map(ext => `.${ext}`).join(',')}
        onChange={fileChangeHandle}
      />
      <div className='flex flex-wrap gap-1'>
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
        <Tooltip
          popupContent={t('datasetHitTesting.imageUploader.tooltip', {
            size: fileUploadConfig.imageFileSizeLimit,
            batchCount: fileUploadConfig.batchCountLimit,
          })}
          popupClassName='system-xs-medium p-1.5 rounded-lg text-text-secondary'
          position='top'
          offset={4}
          disabled={files.length === 0}
        >
          <div
            className='group flex cursor-pointer items-center gap-x-2'
            onClick={selectHandle}
          >
            <div className='flex size-8 items-center justify-center rounded-lg border-[1px] border-dashed border-components-dropzone-border bg-components-button-tertiary-bg group-hover:bg-components-button-tertiary-bg-hover'>
              <RiImageAddLine className='size-4 text-text-tertiary' />
            </div>
            {files.length === 0 && (
              <span className='system-sm-regular text-text-quaternary group-hover:text-text-tertiary'>
                {t('datasetHitTesting.imageUploader.tip', {
                  size: fileUploadConfig.imageFileSizeLimit,
                  batchCount: fileUploadConfig.batchCountLimit,
                })}
              </span>
            )}
          </div>
        </Tooltip>
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

export default React.memo(ImageUploader)
