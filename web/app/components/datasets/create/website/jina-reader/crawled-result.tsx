'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import CheckboxWithLabel from './base/checkbox-with-label'
import CrawledResultItem from './crawled-result-item'
import cn from '@/utils/classnames'
import type { CrawlResultItem } from '@/models/datasets'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

interface Props {
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
    <div className={cn(className, 'border-t border-gray-200')}>
      <div className='shadow-xs border-black/8 flex h-[34px] items-center justify-between border-b-[0.5px] bg-gray-50 px-4 text-xs font-normal text-gray-700'>
        <CheckboxWithLabel
          isChecked={isCheckAll}
          onChange={handleCheckedAll} label={isCheckAll ? t(`${I18N_PREFIX}.resetAll`) : t(`${I18N_PREFIX}.selectAll`)}
          labelClassName='!font-medium'
        />
        <div>{t(`${I18N_PREFIX}.scrapTimeInfo`, {
          total: list.length,
          time: usedTime.toFixed(1),
        })}</div>
      </div>
      <div className='p-2'>
        {list.map((item, index) => (
          <CrawledResultItem
            key={item.source_url}
            isPreview={index === previewIndex}
            onPreview={handlePreview(index)}
            payload={item}
            isChecked={checkedList.some(checkedItem => checkedItem.source_url === item.source_url)}
            onCheckChange={handleItemCheckChange(item)}
          />
        ))}
      </div>
    </div>
  )
}
export default React.memo(CrawledResult)
