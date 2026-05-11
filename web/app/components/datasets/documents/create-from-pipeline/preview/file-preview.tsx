'use client'
import type { CustomFile as File } from '@/models/datasets'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFilePreview } from '@/service/use-common'
import { formatFileSize, formatNumberAbbreviated } from '@/utils/format'
import DocumentFileIcon from '../../../common/document-file-icon'
import Loading from './loading'

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

  const fileName = useMemo(() => {
    if (!file)
      return ''
    const arr = file.name.split('.')
    return arr.slice(0, -1).join()
  }, [file])

  return (
    <div className="flex h-full w-full flex-col rounded-t-xl border-t border-l border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5">
      <div className="flex gap-x-2 border-b border-divider-subtle pt-4 pr-4 pb-3 pl-6">
        <div className="flex grow flex-col gap-y-1">
          <div className="system-2xs-semibold-uppercase text-text-accent">{t('addDocuments.stepOne.preview', { ns: 'datasetPipeline' })}</div>
          <div className="text-tex-primary title-md-semi-bold">{`${fileName}.${file.extension || ''}`}</div>
          <div className="flex items-center gap-x-1 system-xs-medium text-text-tertiary">
            <DocumentFileIcon
              className="size-3.5 shrink-0"
              name={file.name}
              extension={file.extension}
            />
            <span className="uppercase">{file.extension}</span>
            <span>·</span>
            <span>{formatFileSize(file.size)}</span>
            {fileData && (
              <>
                <span>·</span>
                <span>{`${formatNumberAbbreviated(fileData.content.length)} ${t('addDocuments.characters', { ns: 'datasetPipeline' })}`}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center"
          onClick={hidePreview}
        >
          <RiCloseLine className="size-[18px]" />
        </button>
      </div>
      {isFetching && (
        <div className="grow">
          <Loading />
        </div>
      )}
      {!isFetching && fileData && (
        <div className="grow overflow-hidden px-6 py-5 body-md-regular text-text-secondary">
          {fileData.content}
        </div>
      )}
    </div>
  )
}

export default FilePreview
