'use client'

import { Input as BaseInput } from '@base-ui/react/input'
import { cn } from '../cn'
import { textControlClassName } from '../form-control-shared'
import { resolveClassName } from '../internal/resolve-class-name'

type InputProps = Omit<BaseInput.Props, 'size'>
type InputChangeEventReason = BaseInput.ChangeEventReason
type InputChangeEventDetails = BaseInput.ChangeEventDetails

function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={(state) =>
        cn(
          textControlClassName,
          'rounded-lg px-3 py-1.75 system-sm-regular',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

export { Input }
export type { InputChangeEventDetails, InputChangeEventReason, InputProps }
