import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiImageAddLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
        <Tooltip disabled={files.length === 0}>
          <TooltipTrigger
            render={(
              <div
                className="group flex cursor-pointer items-center gap-x-2"
                onClick={selectHandle}
              />
            )}
          >
            <div className="flex size-8 items-center justify-center rounded-lg border border-dashed border-components-dropzone-border bg-components-button-tertiary-bg group-hover:bg-components-button-tertiary-bg-hover">
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
          </TooltipTrigger>
          <TooltipContent sideOffset={4} className="rounded-lg p-1.5 system-xs-medium text-text-secondary">
            {t('imageUploader.tooltip', {
              ns: 'datasetHitTesting',
              size: fileUploadConfig.imageFileSizeLimit,
              batchCount: fileUploadConfig.imageFileBatchLimit,
            })}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

export default React.memo(ImageUploader)
