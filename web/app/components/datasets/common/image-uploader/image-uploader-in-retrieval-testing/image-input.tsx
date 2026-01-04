import { RiImageAddLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { ACCEPT_TYPES } from '../constants'
import { useUpload } from '../hooks/use-upload'
import { useFileStoreWithSelector } from '../store'

const ImageUploader = () => {
  const { t } = useTranslation()
  const files = useFileStoreWithSelector(s => s.files)

  const {
    fileUploadConfig,
    uploaderRef,
    fileChangeHandle,
    selectHandle,
  } = useUpload()

  return (
    <div>
      <input
        ref={uploaderRef}
        id="fileUploader"
        className="hidden"
        type="file"
        multiple
        accept={ACCEPT_TYPES.map(ext => `.${ext}`).join(',')}
        onChange={fileChangeHandle}
      />
      <div className="flex flex-wrap gap-1">
        <Tooltip
          popupContent={t('imageUploader.tooltip', {
            ns: 'datasetHitTesting',
            size: fileUploadConfig.imageFileSizeLimit,
            batchCount: fileUploadConfig.imageFileBatchLimit,
          })}
          popupClassName="system-xs-medium p-1.5 rounded-lg text-text-secondary"
          position="top"
          offset={4}
          disabled={files.length === 0}
        >
          <div
            className="group flex cursor-pointer items-center gap-x-2"
            onClick={selectHandle}
          >
            <div className="flex size-8 items-center justify-center rounded-lg border-[1px] border-dashed border-components-dropzone-border bg-components-button-tertiary-bg group-hover:bg-components-button-tertiary-bg-hover">
              <RiImageAddLine className="size-4 text-text-tertiary" />
            </div>
            {files.length === 0 && (
              <span className="system-sm-regular text-text-quaternary group-hover:text-text-tertiary">
                {t('imageUploader.tip', {
                  ns: 'datasetHitTesting',
                  size: fileUploadConfig.imageFileSizeLimit,
                  batchCount: fileUploadConfig.imageFileBatchLimit,
                })}
              </span>
            )}
          </div>
        </Tooltip>
      </div>
    </div>
  )
}

export default React.memo(ImageUploader)
