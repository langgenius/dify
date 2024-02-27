'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import React, { useCallback } from 'react'
import produce from 'immer'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import type { ValueSelector } from '@/app/components/workflow/types'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  readonly: boolean
  list: ValueSelector[]
  onChange: (list: ValueSelector[]) => void
}

const VarList: FC<Props> = ({
  readonly,
  list,
  onChange,
}) => {
  const { t } = useTranslation()
  const handleVarReferenceChange = useCallback((index: number) => {
    return (value: ValueSelector) => {
      const newList = produce(list, (draft) => {
        draft[index] = value
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleVarRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  if (list.length === 0) {
    return (
      <div className='flex rounded-md bg-gray-50 items-center h-[42px] justify-center leading-[18px] text-xs font-normal text-gray-500'>
        {t('workflow.nodes.variableAssigner.noVarTip')}
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {list.map((item, index) => (
        <div className='flex items-center space-x-1' key={index}>
          <VarReferencePicker
            readonly={readonly}
            isShowNodeName
            className='grow'
            value={item}
            onChange={handleVarReferenceChange(index)}
          />
          <div
            className='p-2 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer'
            onClick={handleVarRemove(index)}
          >
            <Trash03 className='w-4 h-4 text-gray-500' />
          </div>
        </div>
      ))}
    </div>
  )
}
export default React.memo(VarList)
