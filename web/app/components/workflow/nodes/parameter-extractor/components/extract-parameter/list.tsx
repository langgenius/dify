'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { Param } from '../../types'
import ListNoDataPlaceholder from '../../../_base/components/list-no-data-placeholder'
import Item from './item'
const i18nPrefix = 'workflow.nodes.parameterExtractor'

type Props = {
  readonly: boolean
  list: Param[]
  onChange: (list: Param[]) => void
}

const List: FC<Props> = ({
  list,
  onChange,
}) => {
  const { t } = useTranslation()
  const handleItemChange = useCallback((index: number) => {
    return (payload: Param) => {
      const newList = list.map((item, i) => {
        if (i === index)
          return payload

        return item
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleItemEdit = useCallback((index: number) => {
    return () => {
      // return handleItemChange(index)
    }
  }, [])

  const handleItemDelete = useCallback((index: number) => {
    return () => {
      const newList = list.filter((_, i) => i !== index)
      onChange(newList)
    }
  }, [list, onChange])

  if (list.length === 0) {
    return (
      <ListNoDataPlaceholder >{t(`${i18nPrefix}.extractParametersNotSet`)}</ListNoDataPlaceholder>
    )
  }
  return (
    <div className='space-y-1'>
      {list.map((item, index) => (
        <Item
          key={index}
          payload={item}
          onDelete={handleItemDelete(index)}
          onEdit={handleItemEdit(index)}
        />
      ))}
    </div>
  )
}
export default React.memo(List)
