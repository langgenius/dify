'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
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
    <div className={cn(isPreview ? 'bg-primary-50 shadow-xs border-[#D1E0FF]' : 'group hover:bg-gray-100', 'cursor-pointer rounded-md border border-transparent px-2 py-[5px]')}>
      <div className='flex h-5 items-center'>
        <Checkbox className='group-hover:border-primary-600 mr-2 shrink-0 group-hover:border-2' checked={isChecked} onCheck={handleCheckChange} />
        <div className='w-0 grow truncate text-sm font-medium text-gray-700' title={payload.title}>{payload.title}</div>
        <div onClick={onPreview} className='hidden h-6 items-center rounded-md px-2 text-xs font-medium uppercase text-gray-500 hover:bg-gray-50 group-hover:flex'>{t('datasetCreation.stepOne.website.preview')}</div>
      </div>
      <div className='mt-0.5 truncate pl-6 text-xs font-normal leading-[18px] text-gray-500' title={payload.source_url}>{payload.source_url}</div>
    </div>
  )
}
export default React.memo(CrawledResultItem)
