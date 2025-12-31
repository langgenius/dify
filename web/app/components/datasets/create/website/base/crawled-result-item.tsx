'use client'
import type { FC } from 'react'
import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import { cn } from '@/utils/classnames'

type Props = {
  payload: CrawlResultItemType
  isChecked: boolean
  isPreview: boolean
  onCheckChange: (checked: boolean) => void
  onPreview: () => void
  testId?: string
}

const CrawledResultItem: FC<Props> = ({
  isPreview,
  payload,
  isChecked,
  onCheckChange,
  onPreview,
  testId,
}) => {
  const { t } = useTranslation()

  const handleCheckChange = useCallback(() => {
    onCheckChange(!isChecked)
  }, [isChecked, onCheckChange])
  return (
    <div className={cn(isPreview ? 'bg-state-base-active' : 'group hover:bg-state-base-hover', 'cursor-pointer rounded-lg p-2')}>
      <div className="relative flex">
        <div className="flex h-5 items-center">
          <Checkbox className="mr-2 shrink-0" checked={isChecked} onCheck={handleCheckChange} id={testId} />
        </div>
        <div className="flex min-w-0 grow flex-col">
          <div
            className="truncate text-sm font-medium text-text-secondary"
            title={payload.title}
          >
            {payload.title}
          </div>
          <div
            className="mt-0.5 truncate text-xs text-text-tertiary"
            title={payload.source_url}
          >
            {payload.source_url}
          </div>
        </div>
        <Button
          onClick={onPreview}
          className="right-0 top-0 hidden h-6 px-1.5 text-xs font-medium uppercase group-hover:absolute group-hover:block"
        >
          {t('stepOne.website.preview', { ns: 'datasetCreation' })}
        </Button>
      </div>
    </div>
  )
}
export default React.memo(CrawledResultItem)
