'use client'
import type { Param } from '../../types'
import type { MoreInfo } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ListNoDataPlaceholder from '../../../_base/components/list-no-data-placeholder'
import { ParameterItem } from './item'

const i18nPrefix = 'nodes.parameterExtractor'

type Props = Readonly<{
  readonly: boolean
  list: Param[]
  onChange: (list: Param[], moreInfo?: MoreInfo) => void
}>

export function ExtractParameterList({ readonly, list, onChange }: Props) {
  const { t } = useTranslation(['workflowModels'])

  const handleItemChange = useCallback(
    (index: number) => {
      return (payload: Param, moreInfo?: MoreInfo) => {
        const newList = list.map((item, i) => {
          if (i === index) return payload

          return item
        })
        onChange(newList, moreInfo)
      }
    },
    [list, onChange],
  )

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
        {t(($) => $[`${i18nPrefix}.extractParametersNotSet`], { ns: 'workflowModels' })}
      </ListNoDataPlaceholder>
    )
  }
  return (
    <div className="space-y-1">
      {list.map((item, index) => (
        <ParameterItem
          key={index}
          payload={item}
          onDelete={handleItemDelete(index)}
          readonly={readonly}
          onSave={handleItemChange(index)}
        />
      ))}
    </div>
  )
}
