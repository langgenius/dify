import { RiUploadCloud2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import { ACCEPT_TYPES } from '../constants'
import { useUpload } from '../hooks/use-upload'

const ImageUploader = () => {
  const { t } = useTranslation()

  const {
    dragging,
    fileUploadConfig,
    dragRef,
    dropRef,
    uploaderRef,
    fileChangeHandle,
    selectHandle,
  } = useUpload()

  return (
    <div className="w-full">
      <input
        ref={uploaderRef}
        id="fileUploader"
        className="hidden"
        type="file"
        multiple
        accept={ACCEPT_TYPES.map(ext => `.${ext}`).join(',')}
        onChange={fileChangeHandle}
      />
      <div
        ref={dropRef}
        className={cn(
          'relative flex h-16 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-4 py-3 text-text-tertiary',
          dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
        )}
      >
        <div className="system-sm-medium flex items-center justify-center gap-x-2 text-text-secondary">
          <RiUploadCloud2Line className="size-5 text-text-tertiary" />
          <div>
            <span>{t('imageUploader.button', { ns: 'dataset' })}</span>
            <span
              className="ml-1 cursor-pointer text-text-accent"
              onClick={selectHandle}
            >
              {t('imageUploader.browse', { ns: 'dataset' })}
            </span>
          </div>
        </div>
        <div className="system-xs-regular">
          {t('imageUploader.tip', {
            ns: 'dataset',
            size: fileUploadConfig.imageFileSizeLimit,
            supportTypes: ACCEPT_TYPES.join(', '),
            batchCount: fileUploadConfig.imageFileBatchLimit,
          })}
        </div>
        {dragging && <div ref={dragRef} className="absolute inset-0" />}
      </div>
    </div>
  )
}

export default React.memo(ImageUploader)
