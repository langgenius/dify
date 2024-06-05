'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import CheckboxWithLabel from './base/checkbox-with-label'
import CrawledResultItem from './crawled-result-item'
import type { CrawlResultItem } from '@/models/datasets'

const I18N_PREFIX = 'datasetCreation.stepOne.website'

type Props = {
  list: CrawlResultItem[]
  checkedList: CrawlResultItem[]
  onSelectedChange: (selected: CrawlResultItem[]) => void
}

const CrawledResult: FC<Props> = ({
  list,
  checkedList,
  onSelectedChange,
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

  return (
    <div className='border-t border-gray-200'>
      <div className='flex items-center justify-between h-[34px] px-4 bg-gray-50 shadow-xs border-b-[0.5px] border-black/8 text-xs font-normal text-gray-700'>
        <CheckboxWithLabel
          isChecked={isCheckAll}
          onChange={handleCheckedAll} label={isCheckAll ? t(`${I18N_PREFIX}.resetAll`) : t(`${I18N_PREFIX}.selectAll`)}
          labelClassName='!font-medium'
        />
        <div>{t(`${I18N_PREFIX}.scrapTimeInfo`, {
          total: list.length,
          time: '12.4 seconds',
        })}</div>
      </div>
      <div className='p-2'>
        {list.map(item => (
          <CrawledResultItem
            key={item.source_url}
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
