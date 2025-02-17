'use client'
import type { FC } from 'react'
import React from 'react'
import { DataType } from '../types'
import Input from '@/app/components/base/input'
import { InputNumber } from '@/app/components/base/input-number'
import cn from '@/utils/classnames'

type Props = {
  type: DataType
  value: any
  onChange: (value: any) => void
}

const InputCombined: FC<Props> = ({
  type,
  value,
  onChange,
}) => {
  const className = 'grow p-0.5 h-6  text-xs'
  if (type === DataType.time)
    return <div className='grow text-xs'>Datepicker placeholder</div>

  if (type === DataType.number) {
    return (
      <div className='grow text-[0]'>
        <InputNumber
          className={cn(className, 'rounded-l-md')}
          value={value}
          onChange={onChange}
          size='sm'
          controlWrapClassName='overflow-hidden'
          controlClassName='pt-0 pb-0'
        />
      </div>
    )
  }
  return (
    <Input
      className={cn(className, 'rounded-md')}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
    </Input>
  )
}
export default React.memo(InputCombined)
