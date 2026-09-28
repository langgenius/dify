'use client'

import type { Button as BaseButtonNS } from '@base-ui/react/button'
import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
import { iconButtonVariants } from './variants'

type AccessibleName =
  | {
      'aria-label': string
      'aria-labelledby'?: never
    }
  | {
      'aria-label'?: never
      'aria-labelledby': string
    }

type IconButtonProps = Omit<BaseButtonNS.Props, 'aria-label' | 'aria-labelledby' | 'children'> &
  AccessibleName &
  VariantProps<typeof iconButtonVariants> & {
    children: React.ReactElement
  }

function IconButton({
  className,
  variant,
  tone,
  size,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <BaseButton
      type={type}
      className={(state) =>
        cn(iconButtonVariants({ variant, tone, size }), resolveClassName(className, state))
      }
      {...props}
    >
      {children}
    </BaseButton>
  )
}

export { IconButton, iconButtonVariants }

export type { IconButtonProps }
