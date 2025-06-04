'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { CrawlResultItem } from '@/models/datasets'
import { RiCloseLine, RiGlobalLine } from '@remixicon/react'
import { formatNumberAbbreviated } from '@/utils/format'

type WebsitePreviewProps = {
  payload: CrawlResultItem
  hidePreview: () => void
}

const WebsitePreview = ({
  payload,
  hidePreview,
}: WebsitePreviewProps) => {
  const { t } = useTranslation()

  return (
    <div className='h-full rounded-t-xl border-l border-t border-components-panel-border bg-background-default-lighter shadow-md shadow-shadow-shadow-5'>
      <div className='flex gap-x-2 pb-3 pl-6 pr-4 pt-4'>
        <div className='flex grow flex-col gap-y-1'>
          <div className='system-2xs-semibold-uppercase'>{t('datasetPipeline.addDocuments.stepOne.preview')}</div>
          <div className='title-md-semi-bold text-tex-primary'>{payload.title}</div>
          <div className='system-xs-medium flex gap-x-1  text-text-tertiary'>
            <RiGlobalLine className='size-3.5' />
            <span className='uppercase' title={payload.source_url}>{payload.source_url}</span>
            <span>·</span>
            <span>·</span>
            <span>{`${formatNumberAbbreviated(payload.markdown.length)} ${t('datasetPipeline.addDocuments.characters')}`}</span>
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
        <div className='body-md-regular overflow-hidden text-text-secondary'>{payload.markdown}</div>
      </div>
    </div>
  )
}

export default WebsitePreview
