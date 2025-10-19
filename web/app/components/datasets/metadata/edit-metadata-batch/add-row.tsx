'use client'
import type { FC } from 'react'
import React from 'react'
import type { MetadataItemWithEdit } from '../types'
import cn from '@/utils/classnames'
import Label from './label'
import InputCombined from './input-combined'
import { RiIndeterminateCircleLine } from '@remixicon/react'

type Props = {
  className?: string
  payload: MetadataItemWithEdit
  onChange: (value: MetadataItemWithEdit) => void
  onRemove: () => void
}

const AddRow: FC<Props> = ({
  className,
  payload,
  onChange,
  onRemove,
}) => {
  return (
    <div className={cn('flex h-6 items-center space-x-0.5', className)}>
      <Label text={payload.name} />
      <InputCombined
        type={payload.type}
        value={payload.value}
        onChange={value => onChange({ ...payload, value })}
      />
      <div
        className={
          cn(
            'cursor-pointer rounded-md p-1 text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive',
          )
        }
        onClick={onRemove}
      >
        <RiIndeterminateCircleLine className='size-4' />
      </div>
    </div>
  )
}

export default React.memo(AddRow)
