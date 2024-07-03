'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import type { FilterItem, FilterMode, FilterModeToMetadataFilterConfigDict } from '../types'
import ItemList from './metadata-filter-list'

type Props = {
  value: FilterModeToMetadataFilterConfigDict
  onChange: (list: FilterModeToMetadataFilterConfigDict) => void
  nodeId: string
  readonly: boolean
}

const MetaDataFilterModes: FC<Props> = ({
  value,
  onChange,
  nodeId,
  readonly,
}) => {
  const { t } = useTranslation()
  const list = useMemo(() => {
    if (!value)
      return []
    const keys = Object.keys(value) as FilterMode[]

    return keys.filter((key) => {
      return value[key]?.filter_items?.length
    })
  }, [value])

  const handleRemove = useCallback((mode: FilterMode) => {
    const newValue = produce(value, (draft) => {
      draft[mode] = {
        filter_items: [],
      }
    })
    onChange(newValue)
  }, [value, onChange])

  const handleChange = useCallback((mode: FilterMode, v: FilterItem[]) => {
    const newList = produce(value, (draft) => {
      draft[mode].filter_items = v
    })
    onChange(newList)
  }, [value, onChange])
  return (
    <div className='space-y-1'>
      {list.length
        ? list.map((key) => {
          return (
            <ItemList
              key={key}
              mode={key}
              data={value[key].filter_items}
              nodeId={nodeId}
              onChange={handleChange}
              onRemove={handleRemove}
              readonly={readonly}
            />
          )
        })
        : (
          <div className='p-3 text-xs text-center text-gray-500 rounded-lg cursor-default select-none bg-gray-50'>
            {t('appDebug.datasetConfig.metaDataFilterTip')}
          </div>
        )
      }

    </div>
  )
}
export default React.memo(MetaDataFilterModes)
