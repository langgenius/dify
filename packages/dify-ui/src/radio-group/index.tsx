'use client'

import type { RadioGroup as BaseRadioGroupNS } from '@base-ui/react/radio-group'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import { cn } from '../cn'

export type RadioGroupProps<Value = string>
  = Omit<BaseRadioGroupNS.Props<Value>, 'className'>
    & {
      className?: string
    }

export function RadioGroup<Value = string>({
  className,
  ...props
}: RadioGroupProps<Value>) {
  return (
    <BaseRadioGroup<Value>
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  )
}
