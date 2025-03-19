'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import type { MetadataItem } from '../types'
import SearchInput from '@/app/components/base/search-input'
import { RiAddLine, RiArrowRightUpLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { getIcon } from '../utils/get-icon'

const i18nPrefix = 'dataset.metadata.selectMetadata'

type Props = {
  list: MetadataItem[]
  onSelect: (data: MetadataItem) => void
  onNew: () => void
  onManage: () => void
}

const SelectMetadata: FC<Props> = ({
  list: notFilteredList,
  onSelect,
  onNew,
  onManage,
}) => {
  const { t } = useTranslation()

  const [query, setQuery] = useState('')
  const list = useMemo(() => {
    if (!query) return notFilteredList
    return notFilteredList.filter((item) => {
      return item.name.toLowerCase().includes(query.toLowerCase())
    })
  }, [query, notFilteredList])
  return (
    <div className='w-[320px] pt-2 pb-0 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg backdrop-blur-[5px]'>
      <SearchInput
        className='mx-2'
        value={query}
        onChange={setQuery}
        placeholder={t(`${i18nPrefix}.search`)}
      />
      <div className='mt-2'>
        {list.map((item) => {
          const Icon = getIcon(item.type)
          return (
            <div
              key={item.id}
              className='mx-1 flex items-center h-6  px-3 justify-between rounded-md hover:bg-state-base-hover cursor-pointer'
              onClick={() => onSelect({
                id: item.id,
                name: item.name,
                type: item.type,
              })}
            >
              <div className='w-0 grow flex items-center h-full text-text-secondary'>
                <Icon className='shrink-0 mr-[5px] size-3.5' />
                <div className='w-0 grow truncate system-sm-medium'>{item.name}</div>
              </div>
              <div className='ml-1 shrink-0 system-xs-regular text-text-tertiary'>
                {item.type}
              </div>
            </div>
          )
        })}
      </div>
      <div className='mt-1 flex justify-between p-1 border-t border-divider-subtle'>
        <div className='flex items-center h-6 px-3 text-text-secondary rounded-md hover:bg-state-base-hover cursor-pointer space-x-1' onClick={onNew}>
          <RiAddLine className='size-3.5' />
          <div className='system-sm-medium'>{t(`${i18nPrefix}.newAction`)}</div>
        </div>
        <div className='flex items-center h-6 text-text-secondary '>
          <div className='mr-[3px] w-px h-3 bg-divider-regular'></div>
          <div className='flex h-full items-center px-1.5 hover:bg-state-base-hover rounded-md cursor-pointer' onClick={onManage}>
            <div className='mr-1 system-sm-medium'>{t(`${i18nPrefix}.manageAction`)}</div>
            <RiArrowRightUpLine className='size-3.5' />
          </div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(SelectMetadata)
