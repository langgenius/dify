'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import Checkbox from '@/app/components/base/checkbox'

type Props = {
  payload: CrawlResultItemType
  isChecked: boolean
  onCheckChange: (checked: boolean) => void
}

const CrawledResultItem: FC<Props> = ({
  payload,
  isChecked,
  onCheckChange,
}) => {
  const handleCheckChange = useCallback(() => {
    onCheckChange(!isChecked)
  }, [isChecked, onCheckChange])
  return (
    <div className='rounded-md px-2 py-[5px] hover:bg-gray-100'>
      <div className='flex items-center h-5'>
        <Checkbox className='shrink-0 self-start ' checked={isChecked} onCheck={handleCheckChange} />
        <div className='grow w-0 truncate text-sm font-medium text-gray-700' title={payload.title}>{payload.title}</div>
        <div className='px-2 text-xs font-medium text-gray-500 uppercase'>Preview</div>
      </div>
      <div className='mt-2 truncate pl-6' title={payload.source_url}>{payload.source_url}</div>
    </div>
  )
}
export default React.memo(CrawledResultItem)
