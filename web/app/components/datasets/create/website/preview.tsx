'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { XMarkIcon } from '@heroicons/react/20/solid'
import s from '../file-preview/index.module.css'
import cn from '@/utils/classnames'
import type { CrawlResultItem } from '@/models/datasets'

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
        <div className={cn(s.title)}>
          <span>{t('datasetCreation.stepOne.pagePreview')}</span>
          <div className='flex h-6 w-6 cursor-pointer items-center justify-center' onClick={hidePreview}>
            <XMarkIcon className='h-4 w-4'></XMarkIcon>
          </div>
        </div>
        <div className='break-words text-sm font-medium leading-5 text-gray-900'>
          {payload.title}
        </div>
        <div className='truncate text-xs font-normal leading-[18px] text-gray-500' title={payload.source_url}>{payload.source_url}</div>
      </div>
      <div className={cn(s.previewContent)}>
        <div className={cn(s.fileContent, 'body-md-regular')}>{payload.markdown}</div>
      </div>
    </div>
  )
}

export default WebsitePreview
