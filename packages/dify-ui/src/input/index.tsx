'use client'

import type { Input as BaseInputNS } from '@base-ui/react/input'
import { Input as BaseInput } from '@base-ui/react/input'
import { cn } from '../cn'
import { textControlClassName } from '../form-control-shared'
import { resolveClassName } from '../internals/resolve-class-name'

type InputProps = Omit<BaseInputNS.Props, 'size'>

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
export type { InputProps }
