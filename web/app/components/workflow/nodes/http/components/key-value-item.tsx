'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import type { KeyValue } from '../types'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  payload: KeyValue
  onChange: (newPayload: KeyValue) => void
  onRemove: () => void
  isLastItem: boolean
  onAdd: () => void
}

const KeyValueItem: FC<Props> = ({
  payload,
  onChange,
  onRemove,
  isLastItem,
  onAdd,
}) => {
  const [isKeyEditing, {
    setTrue: setIsKeyEditing,
    setFalse: setIsKeyEditingFalse,

  }] = useBoolean(false)
  const handleKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      key: e.target.value,
      value: payload.value,
    })
  }, [])
  return (
    <div>
      <div>
        {isKeyEditing
          ? (
            <input
              type='text'
              value={payload.key}
              onChange={handleKeyChange}
              onBlur={setIsKeyEditingFalse}
            />
          )
          : <div onClick={setIsKeyEditing}>{payload.key}</div>}
      </div>
      <div
      >
        {payload.value}
        <div
          className='p-1 cursor-pointer rounded-md hover:bg-black/5'
          onClick={onRemove}
        >
          <Trash03 className='w-4 h-4' />
        </div>
      </div>
    </div>
  )
}
export default React.memo(KeyValueItem)
