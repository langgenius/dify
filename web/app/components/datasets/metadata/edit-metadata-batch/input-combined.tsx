'use client'
import type { FC } from 'react'
import * as React from 'react'
import Input from '@/app/components/base/input'
import { InputNumber } from '@/app/components/base/input-number'
import { cn } from '@/utils/classnames'
import Datepicker from '../base/date-picker'
import { DataType } from '../types'

type Props = {
  className?: string
  type: DataType
  value: any
  onChange: (value: any) => void
  readOnly?: boolean
}

const InputCombined: FC<Props> = ({
  className: configClassName,
  type,
  value,
  onChange,
  readOnly,
}) => {
  const className = cn('h-6 grow p-0.5 text-xs')
  if (type === DataType.time) {
    return (
      <Datepicker
        className={className}
        value={value}
        onChange={onChange}
      />
    )
  }

  if (type === DataType.number) {
    return (
      <div className="grow text-[0]">
        <InputNumber
          className={cn(className, 'rounded-l-md')}
          value={value}
          onChange={onChange}
          size="regular"
          controlWrapClassName="overflow-hidden"
          controlClassName="pt-0 pb-0"
          readOnly={readOnly}
        />
      </div>
    )
  }
  return (
    <Input
      wrapperClassName={configClassName}
      className={cn(className, 'rounded-md')}
      value={value}
      onChange={e => onChange(e.target.value)}
      readOnly={readOnly}
    />
  )
}
export default React.memo(InputCombined)
