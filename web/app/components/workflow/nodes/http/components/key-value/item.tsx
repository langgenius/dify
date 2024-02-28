'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import cn from 'classnames'
import produce from 'immer'
import type { KeyValue } from '../../types'
import InputItem from './input-item'

type Props = {
  className?: string
  readonly: boolean
  canRemove: boolean
  payload: KeyValue
  onChange: (newPayload: KeyValue) => void
  onRemove: () => void
  isLastItem: boolean
  onAdd: () => void
}

const KeyValueItem: FC<Props> = ({
  className,
  readonly,
  canRemove,
  payload,
  onChange,
  onRemove,
  isLastItem,
  onAdd,
}) => {
  const handleChange = useCallback((key: string) => {
    return (value: string) => {
      const newPayload = produce(payload, (draft: any) => {
        draft[key] = value
      })
      onChange(newPayload)
      if (key === 'value' && isLastItem)
        onAdd()
    }
  }, [onChange, onAdd, isLastItem, payload])

  return (
    // group class name is for hover row show remove button
    <div className={cn(className, 'group flex items-center h-7 border-t border-gray-200')}>
      <div className='w-1/2 h-full border-r border-gray-200'>
        <InputItem
          className='pr-2.5'
          value={payload.key}
          onChange={handleChange('key')}
          hasRemove={false} />
      </div>
      <div className='w-1/2  h-full'>
        <InputItem
          className='pr-1'
          value={payload.value}
          onChange={handleChange('value')}
          hasRemove={!readonly && canRemove}
          onRemove={onRemove}
        />
      </div>
    </div>
  )
}
export default React.memo(KeyValueItem)
