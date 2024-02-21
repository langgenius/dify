'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import type { OutputVar } from '../../../code/types'
import VarTypePicker from './var-type-picker'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  readonly: boolean
  list: OutputVar[]
  onChange: (list: OutputVar[]) => void
}

const OutputVarList: FC<Props> = ({
  readonly,
  list,
  onChange,
}) => {
  const handleVarNameChange = useCallback((index: number) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const newList = produce(list, (draft) => {
        draft[index].variable = e.target.value
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleVarChange = useCallback((index: number) => {
    return (value: string) => {
      const newList = produce(list, (draft) => {
        draft[index].variable_type = value
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

  return (
    <div className='space-y-2'>
      {list.map((item, index) => (
        <div className='flex items-center space-x-1' key={index}>
          <input
            readOnly={readonly}
            value={item.variable}
            onChange={handleVarNameChange(index)}
            className='w-0 grow h-8 leading-8 px-2.5 rounded-lg border-0 bg-gray-100  text-gray-900 text-[13px] placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
            type='text' />
          <VarTypePicker
            readonly={readonly}
            value={item.variable_type}
            onChange={handleVarChange(index)}
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
export default React.memo(OutputVarList)
