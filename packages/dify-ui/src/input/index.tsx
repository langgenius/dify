'use client'

import type { Input as BaseInputNS } from '@base-ui/react/input'
import type { VariantProps } from 'class-variance-authority'
import { Input as BaseInput } from '@base-ui/react/input'
import { cn } from '../cn'
import { inputVariants } from '../form-control-shared'

export type InputSize = NonNullable<VariantProps<typeof inputVariants>['size']>

export type InputProps
  = Omit<BaseInputNS.Props, 'className' | 'size'>
    & VariantProps<typeof inputVariants>
    & {
      invalid?: boolean
      className?: string
    }

export type InputChangeEventDetails = BaseInputNS.ChangeEventDetails

export function Input({
  className,
  size = 'medium',
  invalid,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const invalidProps = invalid
    ? {
        'aria-invalid': ariaInvalid ?? true,
        'data-invalid': '',
      }
    : ariaInvalid !== undefined
      ? {
          'aria-invalid': ariaInvalid,
        }
      : {}

  return (
    <BaseInput
      className={cn(inputVariants({ size }), className)}
      {...props}
      {...invalidProps}
    />
  )
}
