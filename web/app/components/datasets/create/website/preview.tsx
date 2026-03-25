'use client'
import type { CrawlResultItem } from '@/models/datasets'
import { XMarkIcon } from '@heroicons/react/20/solid'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
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
          <div className="flex h-6 w-6 cursor-pointer items-center justify-center" onClick={hidePreview}>
            <XMarkIcon className="h-4 w-4"></XMarkIcon>
          </div>
        </div>
        <div className="title-sm-semi-bold break-words text-text-primary">
          {payload.title}
        </div>
        <div className="system-xs-medium truncate text-text-tertiary" title={payload.source_url}>{payload.source_url}</div>
      </div>
      <div className={cn(s.previewContent, 'body-md-regular')}>
        <div className={cn(s.fileContent)}>{payload.markdown}</div>
      </div>
    </div>
  )
}

export default WebsitePreview
