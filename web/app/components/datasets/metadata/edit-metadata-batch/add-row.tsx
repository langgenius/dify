'use client'
import type { FC } from 'react'
import type { MetadataItemWithEdit } from '../types'
import { RiIndeterminateCircleLine } from '@remixicon/react'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import InputCombined from './input-combined'
import Label from './label'

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
        <RiIndeterminateCircleLine className="size-4" />
      </div>
    </div>
  )
}

export default React.memo(AddRow)
