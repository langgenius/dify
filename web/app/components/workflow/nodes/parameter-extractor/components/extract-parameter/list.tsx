'use client'
import type { FC } from 'react'
import type { Param } from '../../types'
import type { MoreInfo } from '@/app/components/workflow/types'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ListNoDataPlaceholder from '../../../_base/components/list-no-data-placeholder'
import Item from './item'
import EditParam from './update'

const i18nPrefix = 'nodes.parameterExtractor'

type Props = Readonly<{
  readonly: boolean
  list: Param[]
  onChange: (list: Param[], moreInfo?: MoreInfo) => void
}>

const List: FC<Props> = ({ list, onChange }) => {
  const { t } = useTranslation()
  const [isShowEditModal, setIsShowEditModal] = useState(false)

  const handleItemChange = useCallback(
    (index: number) => {
      return (payload: Param, moreInfo?: MoreInfo) => {
        const newList = list.map((item, i) => {
          if (i === index) return payload

          return item
        })
        onChange(newList, moreInfo)
        setIsShowEditModal(false)
      }
    },
    [list, onChange],
  )

  const [currEditItemIndex, setCurrEditItemIndex] = useState<number>(-1)

  const handleItemEdit = useCallback((index: number) => {
    return () => {
      setCurrEditItemIndex(index)
      setIsShowEditModal(true)
    }
  }, [])

  const handleItemDelete = useCallback(
    (index: number) => {
      return () => {
        const newList = list.filter((_, i) => i !== index)
        onChange(newList)
      }
    },
    [list, onChange],
  )

  if (list.length === 0) {
    return (
      <ListNoDataPlaceholder>
        {t(($) => $[`${i18nPrefix}.extractParametersNotSet`], { ns: 'workflow' })}
      </ListNoDataPlaceholder>
    )
  }
  return (
    <div className="space-y-1">
      {list.map((item, index) => (
        <Item
          key={index}
          payload={item}
          onDelete={handleItemDelete(index)}
          onEdit={handleItemEdit(index)}
        />
      ))}
      {isShowEditModal && (
        <EditParam
          type="edit"
          payload={list[currEditItemIndex]}
          onSave={handleItemChange(currEditItemIndex)}
          onCancel={() => setIsShowEditModal(false)}
        />
      )}
    </div>
  )
}
export default React.memo(List)
