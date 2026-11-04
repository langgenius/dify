'use client'
import type { NotionPage } from '@/models/common'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { skipToken, useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import NotionIcon from '@/app/components/base/notion-icon'
import { consoleQuery } from '@/service/console'
import s from './index.module.css'

type IProps = {
  currentPage?: NotionPage
  notionCredentialId: string
  hidePreview: () => void
}

const NotionPagePreview = ({ currentPage, notionCredentialId, hidePreview }: IProps) => {
  const { t } = useTranslation(['common', 'datasetCreation'])
  const { data, isLoading, isError, isFetching, isFetchedAfterMount, refetch } = useQuery(
    consoleQuery.notion.pages.byPageId.byPageType.preview.get.queryOptions({
      input:
        currentPage && notionCredentialId
          ? {
              params: { page_id: currentPage.page_id, page_type: currentPage.type },
              query: { credential_id: notionCredentialId },
            }
          : skipToken,
    }),
  )
  const hasLoadError = isError || (!data && isFetchedAfterMount)

  return (
    <div className={cn(s.filePreview, 'h-full')}>
      <div className={cn(s.previewHeader)}>
        <div className={cn(s.title, 'title-md-semi-bold')}>
          <span>{t(($) => $['stepOne.pagePreview'], { ns: 'datasetCreation' })}</span>
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
          <NotionIcon
            decorative
            className="mr-1 shrink-0"
            type="page"
            src={currentPage?.page_icon}
          />
          {currentPage?.page_name}
        </div>
      </div>
      <div className={cn(s.previewContent, 'body-md-regular')}>
        {isLoading && !hasLoadError && <LoadingPlaceholder />}
        {hasLoadError && (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-text-secondary">
              {t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
            <Button size="small" loading={isFetching} onClick={() => void refetch()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        )}
        {!hasLoadError && data && (
          <div className={cn(s.fileContent, 'body-md-regular')}>{data.content}</div>
        )}
      </div>
    </div>
  )
}

export default NotionPagePreview
