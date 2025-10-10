'use client'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import type { CrawlResultItem } from '@/models/datasets'
import CheckboxWithLabel from './checkbox-with-label'
import CrawledResultItem from './crawled-result-item'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type CrawledResultProps = {
  className?: string
  previewIndex?: number
  list: CrawlResultItem[]
  checkedList: CrawlResultItem[]
  onSelectedChange: (selected: CrawlResultItem[]) => void
  onPreview?: (payload: CrawlResultItem, index: number) => void
  showPreview?: boolean
  usedTime: number
  isMultipleChoice?: boolean
}

const CrawledResult = ({
  className = '',
  previewIndex,
  list,
  checkedList,
  onSelectedChange,
  usedTime,
  onPreview,
  showPreview = false,
  isMultipleChoice = true,
}: CrawledResultProps) => {
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
      if (checked) {
        if (isMultipleChoice)
          onSelectedChange([...checkedList, item])
        else
          onSelectedChange([item])
      }
      else { onSelectedChange(checkedList.filter(checkedItem => checkedItem.source_url !== item.source_url)) }
    }
  }, [checkedList, onSelectedChange, isMultipleChoice])

  const handlePreview = useCallback((index: number) => {
    if (!onPreview) return
    onPreview(list[index], index)
  }, [list, onPreview])

  return (
    <div className={cn('flex flex-col gap-y-2', className)}>
      <div className='system-sm-medium pt-2 text-text-primary'>
        {t(`${I18N_PREFIX}.scrapTimeInfo`, {
          total: list.length,
          time: usedTime.toFixed(1),
        })}
      </div>
      <div className='overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg'>
        {isMultipleChoice && (
          <div className='flex items-center px-4 py-2'>
            <CheckboxWithLabel
              isChecked={isCheckAll}
              onChange={handleCheckedAll} label={isCheckAll ? t(`${I18N_PREFIX}.resetAll`) : t(`${I18N_PREFIX}.selectAll`)}
            />
          </div>
        )}
        <div className='flex flex-col gap-y-px border-t border-divider-subtle bg-background-default-subtle p-2'>
          {list.map((item, index) => (
            <CrawledResultItem
              key={item.source_url}
              payload={item}
              isChecked={checkedList.some(checkedItem => checkedItem.source_url === item.source_url)}
              onCheckChange={handleItemCheckChange(item)}
              isPreview={index === previewIndex}
              onPreview={handlePreview.bind(null, index)}
              showPreview={showPreview}
              isMultipleChoice={isMultipleChoice}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
export default React.memo(CrawledResult)
