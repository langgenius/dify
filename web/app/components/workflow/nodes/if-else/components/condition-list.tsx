'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import VarReferencePicker from '../../_base/components/variable/var-reference-picker'
import type { Condition } from '@/app/components/workflow/nodes/if-else/types'
import type { ValueSelector } from '@/app/components/workflow/types'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'
const i18nPrefix = 'workflow.nodes.ifElse'

type Props = {
  readonly: boolean
  list: Condition[]
  onChange: (newList: Condition[]) => void
}

type ItemProps = {
  readonly: boolean
  payload: Condition
  onChange: (newItem: Condition) => void
  canRemove: boolean
  onRemove?: () => void
}

const Item: FC<ItemProps> = ({
  readonly,
  payload,
  onChange,
  canRemove,
  onRemove = () => { },
}) => {
  const { t } = useTranslation()

  const handleVarReferenceChange = useCallback((value: ValueSelector) => {
    onChange({
      ...payload,
      variable_selector: value,
    })
  }, [onChange, payload])

  const handleValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...payload,
      value: e.target.value,
    })
  }, [onChange, payload])

  return (
    <div className='flex items-center space-x-1'>
      <VarReferencePicker
        readonly={readonly}
        isShowNodeName
        className='grow'
        value={payload.variable_selector}
        onChange={handleVarReferenceChange}
      />

      <input
        readOnly={readonly}
        value={payload.value}
        onChange={handleValueChange}
        placeholder={t(`${i18nPrefix}.enterValue`)!}
        className='w-[144px] h-8 leading-8 px-2.5  rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px]  placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
        type='text'
      />

      <div
        className={cn(canRemove ? 'text-gray-500 bg-gray-100 hover:bg-gray-200  cursor-pointer' : 'bg-gray-25 text-gray-300', 'p-2 rounded-lg ')}
        onClick={onRemove}
      >
        <Trash03 className='w-4 h-4 ' />
      </div>
    </div>
  )
}

const ConditionList: FC<Props> = ({
  readonly,
  list,
  onChange,
}) => {
  const handleItemChange = useCallback((index: number) => {
    return (newItem: Condition) => {
      const newList = produce(list, (draft) => {
        draft[index] = newItem
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleItemRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  if (list.length === 0)
    return null

  return (
    <div>
      <Item
        readonly={readonly}
        payload={list[0]}
        onChange={handleItemChange(0)}
        canRemove={false}
      />

      {
        list.length > 1 && (
          <>
            <div className='flex items-center justify-center h-6 text-gray-500'>
              AND
            </div>
            {
              list.slice(1).map((item, i) => (
                <Item
                  key={item.id}
                  readonly={readonly}
                  payload={item}
                  onChange={handleItemChange(i + 1)}
                  canRemove
                  onRemove={handleItemRemove(i + 1)}
                />
              ))
            }
          </>)
      }
    </div>
  )
}
export default React.memo(ConditionList)
