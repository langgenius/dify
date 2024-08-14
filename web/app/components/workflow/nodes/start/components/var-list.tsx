'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import VarItem from './var-item'
import { ChangeType, type InputVar, type MoreInfo } from '@/app/components/workflow/types'
type Props = {
  readonly: boolean
  list: InputVar[]
  onChange: (list: InputVar[], moreInfo?: { index: number; payload: MoreInfo }) => void
}

const VarList: FC<Props> = ({
  readonly,
  list,
  onChange,
}) => {
  const { t } = useTranslation()

  const handleVarChange = useCallback((index: number) => {
    return (payload: InputVar, moreInfo?: MoreInfo) => {
      const newList = produce(list, (draft) => {
        draft[index] = payload
      })
      onChange(newList, moreInfo ? { index, payload: moreInfo } : undefined)
    }
  }, [list, onChange])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList, {
        index,
        payload: {
          type: ChangeType.remove,
          payload: {
            beforeKey: list[index].variable,
          },
        },
      })
    }
  }, [list, onChange])

  if (list.length === 0) {
    return (
      <div className='flex rounded-md bg-gray-50 items-center h-[42px] justify-center leading-[18px] text-xs font-normal text-gray-500'>
        {t('workflow.nodes.start.noVarTip')}
      </div>
    )
  }

  return (
    <div className='space-y-1'>
      {list.map((item, index) => (
        <VarItem
          key={index}
          readonly={readonly}
          payload={item}
          onChange={handleVarChange(index)}
          onRemove={handleVarRemove(index)}
          varKeys={list.map(item => item.variable)}
        />
      ))}
    </div>
  )
}
export default React.memo(VarList)
