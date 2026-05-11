'use client'
import type { CrawlResultItem } from '@/models/datasets'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import s from '../file-preview/index.module.css'

type IProps = {
  payload: CrawlResultItem
  hidePreview: () => void
}

const WebsitePreview = ({
  payload,
  hidePreview,
}: IProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn(s.filePreview, 'h-full')}>
      <div className={cn(s.previewHeader)}>
        <div className={cn(s.title, 'title-md-semi-bold')}>
          <span>{t('stepOne.pagePreview', { ns: 'datasetCreation' })}</span>
          <button
            type="button"
            className="flex h-6 w-6 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
            aria-label={t('operation.close', { ns: 'common' })}
            onClick={hidePreview}
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true"></XMarkIcon>
          </button>
        </div>
        <div className="title-sm-semi-bold wrap-break-word text-text-primary">
          {payload.title}
        </div>
        <div className="truncate system-xs-medium text-text-tertiary" title={payload.source_url}>{payload.source_url}</div>
      </div>
      <div className={cn(s.previewContent, 'body-md-regular')}>
        <div className={cn(s.fileContent)}>{payload.markdown}</div>
      </div>
    </div>
  )
}

export default WebsitePreview
