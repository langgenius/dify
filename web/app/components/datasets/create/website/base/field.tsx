'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { Infotip } from '@/app/components/base/infotip'
import Input from './input'

type Props = {
  className?: string
  label: string
  labelClassName?: string
  value: string | number
  onChange: (value: string | number) => void
  isRequired?: boolean
  placeholder?: string
  isNumber?: boolean
  tooltip?: string
}

const Field: FC<Props> = ({
  className,
  label,
  labelClassName,
  value,
  onChange,
  isRequired = false,
  placeholder = '',
  isNumber = false,
  tooltip,
}) => {
  return (
    <div className={cn(className)}>
      <div className="flex py-[7px]">
        <div className={cn(labelClassName, 'flex h-[16px] items-center text-[13px] font-semibold text-text-secondary')}>
          {label}
          {' '}
        </div>
        {isRequired && <span className="ml-0.5 text-xs font-semibold text-text-destructive">*</span>}
        {tooltip && (
          <Infotip aria-label={tooltip} className="ml-0.5" popupClassName="w-[200px]">
            {tooltip}
          </Infotip>
        )}
      </div>
      <Input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        isNumber={isNumber}
      />
    </div>
  )
}
export default React.memo(Field)
