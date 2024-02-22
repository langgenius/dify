'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import VarItem from './var-item'
import type { InputVar } from '@/app/components/workflow/types'
type Props = {
  readonly: boolean
  list: InputVar[]
  onChange: (list: InputVar[]) => void
}

const VarList: FC<Props> = ({
  readonly,
  list,
  onChange,
}) => {
  const handleVarNameChange = useCallback((index: number) => {
    return (payload: InputVar) => {
      const newList = produce(list, (draft) => {
        draft[index] = payload
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
    <div className='space-y-1'>
      {list.map((item, index) => (
        <VarItem
          key={index}
          readonly={readonly}
          payload={item}
          onChange={handleVarNameChange(index)}
          onRemove={handleVarRemove(index)}
        />
      ))}
    </div>
  )
}
export default React.memo(VarList)
