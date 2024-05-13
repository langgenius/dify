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

  if (list.length === 0) {
    return (
      <ListNoDataPlaceholder >{t(`${i18nPrefix}.extractParametersNotSet`)}</ListNoDataPlaceholder>
    )
  }
  return (
    <div>
      {list.map((item, index) => (
        <Item
          key={index}
          payload={item}
          onChange={handleItemChange(index)}
        />
      ))}
    </div>
  )
}
export default React.memo(List)
