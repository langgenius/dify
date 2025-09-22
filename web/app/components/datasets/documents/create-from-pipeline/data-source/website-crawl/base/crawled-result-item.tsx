'use client'
import React, { useCallback } from 'react'
import cn from '@/utils/classnames'
import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import Checkbox from '@/app/components/base/checkbox'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import Radio from '@/app/components/base/radio/ui'

type CrawledResultItemProps = {
  payload: CrawlResultItemType
  isChecked: boolean
  onCheckChange: (checked: boolean) => void
  isPreview: boolean
  showPreview: boolean
  onPreview: () => void
  isMultipleChoice?: boolean
}

const CrawledResultItem = ({
  payload,
  isChecked,
  onCheckChange,
  isPreview,
  onPreview,
  showPreview,
  isMultipleChoice = true,
}: CrawledResultItemProps) => {
  const { t } = useTranslation()

  const handleCheckChange = useCallback(() => {
    onCheckChange(!isChecked)
  }, [isChecked, onCheckChange])

  return (
    <div className={cn(
      'relative flex cursor-pointer gap-x-2 rounded-lg p-2',
      isPreview ? 'bg-state-base-active' : 'group hover:bg-state-base-hover',
    )}>
      {
        isMultipleChoice ? (
          <Checkbox
            className='shrink-0'
            checked={isChecked}
            onCheck={handleCheckChange}
          />
        ) : (
          <Radio
            isChecked={isChecked}
            onCheck={handleCheckChange}
          />
        )
      }
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
      {showPreview && (
        <Button
          size='small'
          onClick={onPreview}
          className='system-xs-medium-uppercase right-2 top-2 hidden px-1.5 group-hover:absolute group-hover:block'
        >
          {t('datasetCreation.stepOne.website.preview')}
        </Button>
      )}
    </div>
  )
}
export default React.memo(CrawledResultItem)
