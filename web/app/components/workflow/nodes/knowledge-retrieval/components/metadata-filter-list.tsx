'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import type { FilterItem, FilterMode } from '../types'
import { createDefaultFilterItem } from '../default'
import Item from './metadata-filter-item'

type Props = {
  mode: FilterMode
  data: FilterItem[]
  nodeId: string
  onChange: (mode: FilterMode, list: FilterItem[]) => void
  onRemove: (mode: FilterMode) => void
  readonly: boolean
}

const MetadataFilterList: FC<Props> = ({
  mode,
  data,
  nodeId,
  onChange,
  onRemove,
  readonly,
}) => {
  const { t } = useTranslation()

  const handleRemove = useCallback((index: number) => {
    return () => {
      const newData = produce(data, (draft) => {
        draft.splice(index, 1)
      })

      onChange(mode, newData)
    }
  }, [mode, data, onChange])

  const handleChange = useCallback((index: number) => {
    return (value: FilterItem) => {
      const newData = produce(data, (draft) => {
        draft[index] = value
      })
      onChange(mode, newData)
    }
  }, [mode, data, onChange])

  const handleAdd = useCallback(() => {
    const newData = produce(data, (draft) => {
      draft.push(createDefaultFilterItem())
    })
    onChange(mode, newData)
  }, [mode, data, onChange])

  return (
    <div className='space-y-2 rounded-[8px] px-1 bg-white border border-gray-200 relative group'>
      <div className='text-xs text-gray-600 p-2'>
        {t('appDebug.datasetConfig.metaDataFilterModeTip')}：{mode}
      </div>
      {!readonly && (<>
        <div onClick={() => onRemove(mode)} className='absolute right-[8px] top-[-5px] cursor-pointer bg-gray-100 w-6 h-6 hidden items-center justify-center rounded-[8px] group-hover:flex text-grey-600 hover:bg-gray-200'>&times;</div>
        <div onClick={handleAdd} className='absolute right-[36px] top-[-5px] cursor-pointer bg-gray-100 w-6 h-6 hidden items-center justify-center rounded-[8px] group-hover:flex text-grey-600 hover:bg-gray-200'>+</div>
      </>)}
      {data.map((item, index) => {
        return (
          <Item
            key={index}
            payload={item}
            index={index}
            onRemove={handleRemove(index)}
            onChange={handleChange(index)}
            readonly={readonly}
            nodeId={nodeId}
          />
        )
      })}
    </div>
  )
}
export default React.memo(MetadataFilterList)
