'use client'
import React, { useCallback } from 'react'
import cn from '@/utils/classnames'
import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import Checkbox from '@/app/components/base/checkbox'

type CrawledResultItemProps = {
  payload: CrawlResultItemType
  isChecked: boolean
  onCheckChange: (checked: boolean) => void
}

const CrawledResultItem = ({
  payload,
  isChecked,
  onCheckChange,
}: CrawledResultItemProps) => {
  const handleCheckChange = useCallback(() => {
    onCheckChange(!isChecked)
  }, [isChecked, onCheckChange])
  return (
    <div className={cn('group flex cursor-pointer gap-x-2 rounded-lg p-2 hover:bg-state-base-hover')}>
      <Checkbox
        className='shrink-0'
        checked={isChecked}
        onCheck={handleCheckChange}
      />
      <div className='flex min-w-0 grow flex-col gap-y-0.5'>
        <div
          className='system-sm-medium truncate text-text-secondary'
          title={payload.title}
        >
          {payload.title}
        </div>
        <div
          className='system-xs-regular truncate text-text-tertiary'
          title={payload.source_url}
        >
          {payload.source_url}
        </div>
      </div>
    </div>
  )
}
export default React.memo(CrawledResultItem)
