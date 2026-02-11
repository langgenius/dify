'use client'
import type { RefObject } from 'react'
import type { FileUploadConfig } from '../hooks/use-file-upload'
import { RiUploadCloud2Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

export type UploadDropzoneProps = {
  dropRef: RefObject<HTMLDivElement | null>
  dragRef: RefObject<HTMLDivElement | null>
  fileUploaderRef: RefObject<HTMLInputElement | null>
  dragging: boolean
  supportBatchUpload: boolean
  supportTypesShowNames: string
  fileUploadConfig: FileUploadConfig
  acceptTypes: string[]
  onSelectFile: () => void
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

const UploadDropzone = ({
  dropRef,
  dragRef,
  fileUploaderRef,
  dragging,
  supportBatchUpload,
  supportTypesShowNames,
  fileUploadConfig,
  acceptTypes,
  onSelectFile,
  onFileChange,
}: UploadDropzoneProps) => {
  const { t } = useTranslation()

  return (
    <>
      <input
        ref={fileUploaderRef}
        id="fileUploader"
        className="hidden"
        type="file"
        multiple={supportBatchUpload}
        accept={acceptTypes.join(',')}
        onChange={onFileChange}
      />
      <div
        ref={dropRef}
        className={cn(
          'relative mb-2 box-border flex min-h-20 max-w-[640px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-components-dropzone-border bg-components-dropzone-bg px-4 py-3 text-xs leading-4 text-text-tertiary',
          dragging && 'border-components-dropzone-border-accent bg-components-dropzone-bg-accent',
        )}
      >
        <div className="flex min-h-5 items-center justify-center text-sm leading-4 text-text-secondary">
          <RiUploadCloud2Line className="mr-2 size-5" />
          <span>
            {supportBatchUpload
              ? t('stepOne.uploader.button', { ns: 'datasetCreation' })
              : t('stepOne.uploader.buttonSingleFile', { ns: 'datasetCreation' })}
            {acceptTypes.length > 0 && (
              <label
                className="ml-1 cursor-pointer text-text-accent"
                onClick={onSelectFile}
              >
                {t('stepOne.uploader.browse', { ns: 'datasetCreation' })}
              </label>
            )}
          </span>
        </div>
        <div>
          {t('stepOne.uploader.tip', {
            ns: 'datasetCreation',
            size: fileUploadConfig.file_size_limit,
            supportTypes: supportTypesShowNames,
            batchCount: fileUploadConfig.batch_count_limit,
            totalCount: fileUploadConfig.file_upload_limit,
          })}
        </div>
        {dragging && <div ref={dragRef} className="absolute left-0 top-0 h-full w-full" />}
      </div>
    </>
  )
}

export default UploadDropzone
