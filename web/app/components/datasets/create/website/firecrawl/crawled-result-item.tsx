'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import Checkbox from '@/app/components/base/checkbox'

type Props = {
  payload: CrawlResultItemType
  isChecked: boolean
  isPreview: boolean
  onCheckChange: (checked: boolean) => void
  onPreview: () => void
}

const CrawledResultItem: FC<Props> = ({
  isPreview,
  payload,
  isChecked,
  onCheckChange,
  onPreview,
}) => {
  const { t } = useTranslation()

  const handleCheckChange = useCallback(() => {
    onCheckChange(!isChecked)
  }, [isChecked, onCheckChange])
  return (
    <div className={cn(isPreview ? 'border-[#D1E0FF] bg-primary-50 shadow-xs' : 'group hover:bg-gray-100', 'rounded-md px-2 py-[5px] cursor-pointer border border-transparent')}>
      <div className='flex items-center h-5'>
        <Checkbox className='group-hover:border-2 group-hover:border-primary-600 mr-2 shrink-0' checked={isChecked} onCheck={handleCheckChange} />
        <div className='grow w-0 truncate text-sm font-medium text-gray-700' title={payload.title}>{payload.title}</div>
        <div onClick={onPreview} className='hidden group-hover:flex items-center h-6 px-2 text-xs rounded-md font-medium text-gray-500 uppercase hover:bg-gray-50'>{t('datasetCreation.stepOne.website.preview')}</div>
      </div>
      <div className='mt-0.5 truncate pl-6 leading-[18px] text-xs font-normal text-gray-500' title={payload.source_url}>{payload.source_url}</div>
    </div>
  )
}
export default React.memo(CrawledResultItem)
