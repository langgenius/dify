'use client'
import type { CustomFile as File } from '@/models/datasets'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { RiCloseLine } from '@remixicon/react'
import { skipToken, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { formatFileSize, formatNumberAbbreviated } from '@/utils/format'
import DocumentFileIcon from '../../../common/document-file-icon'
import Loading from './loading'

type FilePreviewProps = {
  file: File
  hidePreview: () => void
}

const FilePreview = ({ file, hidePreview }: FilePreviewProps) => {
  const { t } = useTranslation(['datasetPipeline', 'common', 'dataset'])
  const previewQuery = useQuery(
    consoleQuery.files.byFileId.preview.get.queryOptions({
      input: file.id ? { params: { file_id: file.id } } : skipToken,
    }),
  )
  const { data: fileData, isFetching } = previewQuery
  const previewLoad = useOwnedQueryError(previewQuery)
  const loadErrorMessage = useRequestErrorMessage(
    previewLoad?.error,
    t(($) => $.loadError, { ns: 'dataset' }),
  )

  const fileName = useMemo(() => {
    if (!file) return ''
    const arr = file.name.split('.')
    return arr.slice(0, -1).join()
  }, [file])

  return (
    <div className="flex size-full flex-col rounded-t-xl border-s border-t border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5">
      <div className="flex gap-x-2 border-b border-divider-subtle ps-6 pe-4 pt-4 pb-3">
        <div className="flex grow flex-col gap-y-1">
          <div className="system-2xs-semibold-uppercase text-text-accent">
            {t(($) => $['addDocuments.stepOne.preview'], { ns: 'datasetPipeline' })}
          </div>
          <div className="title-md-semi-bold">{`${fileName}.${file.extension || ''}`}</div>
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
                <span>{`${formatNumberAbbreviated(fileData.content.length)} ${t(($) => $['addDocuments.characters'], { ns: 'datasetPipeline' })}`}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center"
          onClick={hidePreview}
        >
          <RiCloseLine className="size-4.5" />
        </button>
      </div>
      {isFetching && (
        <div className="grow">
          <Loading />
        </div>
      )}
      {!isFetching && previewLoad && (
        <div className="grow px-6 py-5">
          <Alert type="error">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button size="small" onClick={previewLoad.retry}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
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
