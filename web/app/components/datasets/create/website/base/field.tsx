'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import * as React from 'react'
import Input from './text-input'

type Props = Readonly<{
  className?: string
  label: string
  labelClassName?: string
  value: string | number
  onChange: (value: string | number) => void
  isRequired?: boolean
  placeholder?: string
  isNumber?: boolean
  tooltip?: string
}>

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
      <div className="flex py-1.75">
        <div
          className={cn(
            labelClassName,
            'flex h-4 items-center text-[13px] font-semibold text-text-secondary',
          )}
        >
          {label}{' '}
        </div>
        {isRequired && (
          <span className="ml-0.5 text-xs font-semibold text-text-destructive">*</span>
        )}
        {tooltip && (
          <Infotip>
            <InfotipTrigger aria-label={tooltip} className="ml-0.5" />
            <InfotipContent aria-label={tooltip} className="w-50">
              {tooltip}
            </InfotipContent>
          </Infotip>
        )}
      </div>
      <Input value={value} onChange={onChange} placeholder={placeholder} isNumber={isNumber} />
    </div>
  )
}
export default React.memo(Field)
