'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import CheckboxWithLabel from './base/checkbox-with-label'
import CrawledResultItem from './crawled-result-item'
import type { CrawlResultItem } from '@/models/datasets'

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
    <div>
      <div className='flex items-center justify-between'>
        <CheckboxWithLabel isChecked={isCheckAll} onChange={handleCheckedAll} label={isCheckAll ? 'Reset All' : 'Select All'} />
        <div className=''>Scraped 10 pages in total within 12.4 seconds</div>
      </div>
      <div>
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
