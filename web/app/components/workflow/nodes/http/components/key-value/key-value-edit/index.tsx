'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import type { KeyValue } from '../../../types'
import KeyValueItem from './item'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.http'

type Props = {
  readonly: boolean
  nodeId: string
  list: KeyValue[]
  onChange: (newList: KeyValue[]) => void
  onAdd: () => void
  isSupportFile?: boolean
  // onSwitchToBulkEdit: () => void
  keyNotSupportVar?: boolean
  insertVarTipToLeft?: boolean
}

const KeyValueList: FC<Props> = ({
  readonly,
  nodeId,
  list,
  onChange,
  onAdd,
  isSupportFile,
  // onSwitchToBulkEdit,
  keyNotSupportVar,
  insertVarTipToLeft,
}) => {
  const { t } = useTranslation()

  const handleChange = useCallback((index: number) => {
    return (newItem: KeyValue) => {
      const newList = produce(list, (draft: any) => {
        draft[index] = newItem
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft: any) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  if (!Array.isArray(list))
    return null

  return (
    <div className='border border-divider-regular rounded-lg overflow-hidden'>
      <div className={cn('flex items-center h-7 leading-7 text-text-tertiary system-xs-medium-uppercase')}>
        <div className={cn('h-full pl-3 border-r border-divider-regular', isSupportFile ? 'w-[140px]' : 'w-1/2')}>{t(`${i18nPrefix}.key`)}</div>
        {isSupportFile && <div className='shrink-0 w-[70px] h-full pl-3 border-r border-divider-regular'>{t(`${i18nPrefix}.type`)}</div>}
        <div className={cn('h-full pl-3 pr-1 items-center justify-between', isSupportFile ? 'grow' : 'w-1/2')}>{t(`${i18nPrefix}.value`)}</div>
      </div>
      {
        list.map((item, index) => (
          <KeyValueItem
            key={item.id}
            instanceId={item.id!}
            nodeId={nodeId}
            payload={item}
            onChange={handleChange(index)}
            onRemove={handleRemove(index)}
            isLastItem={index === list.length - 1}
            onAdd={onAdd}
            readonly={readonly}
            canRemove={list.length > 1}
            isSupportFile={isSupportFile}
            keyNotSupportVar={keyNotSupportVar}
            insertVarTipToLeft={insertVarTipToLeft}
          />
        ))
      }
    </div>
  )
}
export default React.memo(KeyValueList)
