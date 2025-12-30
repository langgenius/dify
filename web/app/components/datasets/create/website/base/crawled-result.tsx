'use client'
import type { FC } from 'react'
import type { CrawlResultItem } from '@/models/datasets'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import CheckboxWithLabel from './checkbox-with-label'
import CrawledResultItem from './crawled-result-item'

const I18N_PREFIX = 'stepOne.website'

type Props = {
  className?: string
  list: CrawlResultItem[]
  checkedList: CrawlResultItem[]
  onSelectedChange: (selected: CrawlResultItem[]) => void
  onPreview: (payload: CrawlResultItem) => void
  usedTime: number
}

const CrawledResult: FC<Props> = ({
  className = '',
  list,
  checkedList,
  onSelectedChange,
  onPreview,
  usedTime,
}) => {
  const { t } = useTranslation()

  const isCheckAll = checkedList.length === list.length

  const handleCheckedAll = useCallback(() => {
    if (!isCheckAll)
      onSelectedChange(list)

    else
      onSelectedChange([])
  }, [isCheckAll, list, onSelectedChange])

  const handleItemCheckChange = useCallback((item: CrawlResultItem) => {
    return (checked: boolean) => {
      if (checked)
        onSelectedChange([...checkedList, item])

      else
        onSelectedChange(checkedList.filter(checkedItem => checkedItem.source_url !== item.source_url))
    }
  }, [checkedList, onSelectedChange])

  const [previewIndex, setPreviewIndex] = React.useState<number>(-1)
  const handlePreview = useCallback((index: number) => {
    return () => {
      setPreviewIndex(index)
      onPreview(list[index])
    }
  }, [list, onPreview])

  return (
    <div className={cn(className, 'border-t-[0.5px] border-divider-regular shadow-xs shadow-shadow-shadow-3')}>
      <div className="flex h-[34px] items-center justify-between px-4">
        <CheckboxWithLabel
          isChecked={isCheckAll}
          onChange={handleCheckedAll}
          label={isCheckAll ? t(`${I18N_PREFIX}.resetAll`, { ns: 'datasetCreation' }) : t(`${I18N_PREFIX}.selectAll`, { ns: 'datasetCreation' })}
          labelClassName="system-[13px] leading-[16px] font-medium text-text-secondary"
          testId="select-all"
        />
        <div className="text-xs text-text-tertiary">
          {t(`${I18N_PREFIX}.scrapTimeInfo`, {
            ns: 'datasetCreation',
            total: list.length,
            time: usedTime.toFixed(1),
          })}
        </div>
      </div>
      <div className="p-2">
        {list.map((item, index) => (
          <CrawledResultItem
            key={item.source_url}
            isPreview={index === previewIndex}
            onPreview={handlePreview(index)}
            payload={item}
            isChecked={checkedList.some(checkedItem => checkedItem.source_url === item.source_url)}
            onCheckChange={handleItemCheckChange(item)}
            testId={`item-${index}`}
          />
        ))}
      </div>
    </div>
  )
}
export default React.memo(CrawledResult)
