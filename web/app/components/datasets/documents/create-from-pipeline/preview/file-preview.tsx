'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Loading from './loading'
import type { CustomFile as File } from '@/models/datasets'
import { RiCloseLine } from '@remixicon/react'
import { useFilePreview } from '@/service/use-common'
import DocumentFileIcon from '../../../common/document-file-icon'
import { formatNumberAbbreviated } from '@/utils/format'

type FilePreviewProps = {
  file: File
  hidePreview: () => void
}

const FilePreview = ({
  file,
  hidePreview,
}: FilePreviewProps) => {
  const { t } = useTranslation()
  const { data: fileData, isFetching } = useFilePreview(file.id || '')

  const getFileName = (currentFile?: File) => {
    if (!currentFile)
      return ''
    const arr = currentFile.name.split('.')
    return arr.slice(0, -1).join()
  }

  const getFileSize = (size: number) => {
    if (size / 1024 < 10)
      return `${(size / 1024).toFixed(1)} KB`

    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className='h-full rounded-t-xl border-l border-t border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5'>
      <div className='flex gap-x-2 pb-3 pl-6 pr-4 pt-4'>
        <div className='flex grow flex-col gap-y-1'>
          <div className='system-2xs-semibold-uppercase'>{t('datasetPipeline.addDocuments.stepOne.preview')}</div>
          <div className='title-md-semi-bold text-tex-primary'>{`${getFileName(file)}.${file.extension}`}</div>
          <div className='system-xs-medium flex gap-x-1  text-text-tertiary'>
            <DocumentFileIcon
              className='size-6 shrink-0'
              name={file.name}
              extension={file.extension}
            />
            <span className='uppercase'>{file.extension}</span>
            <span>·</span>
            <span>{getFileSize(file.size)}</span>
            {fileData && (
              <>
                <span>·</span>
                <span>{`${formatNumberAbbreviated(fileData.content.length)} ${t('datasetPipeline.addDocuments.characters')}`}</span>
              </>
            )}
          </div>
        </div>
        <button
          type='button'
          className='flex h-8 w-8 shrink-0 items-center justify-center'
          onClick={hidePreview}
        >
          <RiCloseLine className='size-[18px]' />
        </button>
      </div>
      <div className='px-6 py-5'>
        {isFetching && <Loading />}
        {!isFetching && fileData && (
          <div className='body-md-regular overflow-hidden text-text-secondary'>{fileData.content}</div>
        )}
      </div>
    </div>
  )
}

export default FilePreview
