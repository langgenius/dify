'use client'
import type { FC } from 'react'
import React from 'react'
import { DataType } from '../types'
import Input from '@/app/components/base/input'

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
  if (type === DataType.time)
    return <div className='grow text-xs'>Datepicker placeholder</div>

  return (
    <Input
      className='p-0.5 h-6 rounded-md text-xs'
      value={value}
      onChange={e => onChange(e.target.value)}
    >
    </Input>
  )
}
export default React.memo(InputCombined)
