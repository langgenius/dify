'use client'
import type { CrawlResultItem as CrawlResultItemType } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Radio } from '@langgenius/dify-ui/radio'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

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

  return (
    <div
      className={cn(
        'relative flex gap-x-2 rounded-lg p-2',
        isPreview ? 'bg-state-base-active' : 'group hover:bg-state-base-hover',
      )}
    >
      {isMultipleChoice ? (
        <label className="flex min-w-0 grow cursor-pointer gap-x-2">
          <Checkbox
            className="shrink-0"
            checked={isChecked}
            onCheckedChange={(checked) => onCheckChange(checked)}
          />
          <div className="flex min-w-0 grow flex-col gap-y-0.5">
            <div className="truncate system-sm-medium text-text-secondary" title={payload.title}>
              {payload.title}
            </div>
            <div
              className="truncate system-xs-regular text-text-tertiary"
              title={payload.source_url}
            >
              {payload.source_url}
            </div>
          </div>
        </label>
      ) : (
        <label className="flex min-w-0 grow cursor-pointer gap-x-2">
          <Radio className="shrink-0" value={payload.source_url} />
          <div className="flex min-w-0 grow flex-col gap-y-0.5">
            <div className="truncate system-sm-medium text-text-secondary" title={payload.title}>
              {payload.title}
            </div>
            <div
              className="truncate system-xs-regular text-text-tertiary"
              title={payload.source_url}
            >
              {payload.source_url}
            </div>
          </div>
        </label>
      )}
      {showPreview && (
        <Button
          size="small"
          onClick={onPreview}
          className="top-2 right-2 hidden px-1.5 system-xs-medium-uppercase group-hover:absolute group-hover:block"
        >
          {t(($) => $['stepOne.website.preview'], { ns: 'datasetCreation' })}
        </Button>
      )}
    </div>
  )
}
export default React.memo(CrawledResultItem)
