'use client'
import type { FC } from 'react'
import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

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
  return (
    <div className={cn(isPreview ? 'bg-state-base-active' : 'group hover:bg-state-base-hover', 'rounded-lg p-2')}>
      <div className="relative flex">
        <label className="flex min-w-0 grow cursor-pointer">
          <div className="flex h-5 items-center">
            <Checkbox
              className="mr-2 shrink-0"
              checked={isChecked}
              onCheckedChange={checked => onCheckChange(checked)}
            />
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
        </label>
        <Button
          onClick={onPreview}
          className="top-0 right-0 hidden h-6 px-1.5 text-xs font-medium uppercase group-hover:absolute group-hover:block"
        >
          {t('stepOne.website.preview', { ns: 'datasetCreation' })}
        </Button>
      </div>
    </div>
  )
}
export default React.memo(CrawledResultItem)
