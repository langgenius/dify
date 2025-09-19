'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { CrawlResultItem } from '@/models/datasets'
import { RiCloseLine, RiGlobalLine } from '@remixicon/react'
import { formatNumberAbbreviated } from '@/utils/format'

type WebsitePreviewProps = {
  currentWebsite: CrawlResultItem
  hidePreview: () => void
}

const WebsitePreview = ({
  currentWebsite,
  hidePreview,
}: WebsitePreviewProps) => {
  const { t } = useTranslation()

  return (
    <div className='flex h-full w-full flex-col rounded-t-xl border-l border-t border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5'>
      <div className='flex gap-x-2 border-b border-divider-subtle pb-3 pl-6 pr-4 pt-4'>
        <div className='flex grow flex-col gap-y-1'>
          <div className='system-2xs-semibold-uppercase'>{t('datasetPipeline.addDocuments.stepOne.preview')}</div>
          <div className='title-md-semi-bold text-tex-primary'>{currentWebsite.title}</div>
          <div className='system-xs-medium flex gap-x-1  text-text-tertiary'>
            <RiGlobalLine className='size-3.5' />
            <span className='uppercase' title={currentWebsite.source_url}>{currentWebsite.source_url}</span>
            <span>·</span>
            <span>·</span>
            <span>{`${formatNumberAbbreviated(currentWebsite.content.length)} ${t('datasetPipeline.addDocuments.characters')}`}</span>
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
      <div className='body-md-regular grow overflow-hidden px-6 py-5 text-text-secondary'>
        {currentWebsite.content}
      </div>
    </div>
  )
}

export default WebsitePreview
