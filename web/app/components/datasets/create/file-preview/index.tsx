'use client'
import type { CustomFile as File } from '@/models/datasets'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { cn } from '@langgenius/dify-ui/cn'
import { skipToken, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { consoleQuery } from '@/service/console'
import s from './index.module.css'

type IProps = {
  file?: File
  hidePreview: () => void
}

const FilePreview = ({ file, hidePreview }: IProps) => {
  const { t } = useTranslation(['common', 'datasetCreation'])
  const headingId = useId()
  const fileID = file?.id
  const { data, isPending, isError } = useQuery(
    consoleQuery.files.byFileId.preview.get.queryOptions({
      input: fileID ? { params: { file_id: fileID } } : skipToken,
      retry: false,
    }),
  )
  const loading = !!fileID && isPending
  const statusText = !fileID
    ? ''
    : loading
      ? t(($) => $.loading, { ns: 'common' })
      : isError
        ? t(($) => $['api.actionFailed'], { ns: 'common' })
        : t(($) => $['api.success'], { ns: 'common' })

  const getFileName = (currentFile?: File) => {
    if (!currentFile) return ''
    const arr = currentFile.name.split('.')
    return arr.slice(0, -1).join()
  }

  return (
    <section aria-labelledby={headingId} className={cn(s.filePreview, 'h-full')}>
      <div className={cn(s.previewHeader)}>
        <div className={cn(s.title, 'title-md-semi-bold')}>
          <h2 id={headingId}>{t(($) => $['stepOne.filePreview'], { ns: 'datasetCreation' })}</h2>
          <button
            type="button"
            className="flex size-6 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            onClick={hidePreview}
          >
            <XMarkIcon className="size-4" aria-hidden="true"></XMarkIcon>
          </button>
        </div>
        <div className={cn(s.fileName, 'system-xs-medium')}>
          <span>{getFileName(file)}</span>
          <span className={cn(s.filetype)}>.{file?.extension}</span>
        </div>
      </div>
      <div
        role="status"
        aria-atomic="true"
        className={cn(isError ? 'px-8 pt-4 text-text-destructive' : 'sr-only')}
      >
        {statusText && `${file?.name}: ${statusText}`}
      </div>
      <div className={cn(s.previewContent)}>
        {loading && <LoadingPlaceholder />}
        {!loading && !isError && (
          <div className={cn(s.fileContent, 'body-md-regular')}>{data?.content}</div>
        )}
      </div>
    </section>
  )
}

export default FilePreview
