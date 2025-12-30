'use client'
import type { FC } from 'react'
import type { MetadataItem } from '../types'
import { RiAddLine, RiArrowRightUpLine } from '@remixicon/react'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import { getIcon } from '../utils/get-icon'

const i18nPrefix = 'metadata.selectMetadata'

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
    if (!query)
      return notFilteredList
    return notFilteredList.filter((item) => {
      return item.name.toLowerCase().includes(query.toLowerCase())
    })
  }, [query, notFilteredList])
  return (
    <div className="w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-0 pt-2 shadow-lg backdrop-blur-[5px]">
      <SearchInput
        className="mx-2"
        value={query}
        onChange={setQuery}
        placeholder={t(`${i18nPrefix}.search`, { ns: 'dataset' })}
      />
      <div className="mt-2">
        {list.map((item) => {
          const Icon = getIcon(item.type)
          return (
            <div
              key={item.id}
              className="mx-1 flex h-6 cursor-pointer  items-center justify-between rounded-md px-3 hover:bg-state-base-hover"
              onClick={() => onSelect({
                id: item.id,
                name: item.name,
                type: item.type,
              })}
            >
              <div className="flex h-full w-0 grow items-center text-text-secondary">
                <Icon className="mr-[5px] size-3.5 shrink-0" />
                <div className="system-sm-medium w-0 grow truncate">{item.name}</div>
              </div>
              <div className="system-xs-regular ml-1 shrink-0 text-text-tertiary">
                {item.type}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between border-t border-divider-subtle p-1">
        <div className="flex h-6 cursor-pointer items-center space-x-1 rounded-md px-3 text-text-secondary hover:bg-state-base-hover" onClick={onNew}>
          <RiAddLine className="size-3.5" />
          <div className="system-sm-medium">{t(`${i18nPrefix}.newAction`, { ns: 'dataset' })}</div>
        </div>
        <div className="flex h-6 items-center text-text-secondary ">
          <div className="mr-[3px] h-3 w-px bg-divider-regular"></div>
          <div className="flex h-full cursor-pointer items-center rounded-md px-1.5 hover:bg-state-base-hover" onClick={onManage}>
            <div className="system-sm-medium mr-1">{t(`${i18nPrefix}.manageAction`, { ns: 'dataset' })}</div>
            <RiArrowRightUpLine className="size-3.5" />
          </div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(SelectMetadata)
