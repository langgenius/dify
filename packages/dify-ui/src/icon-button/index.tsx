'use client'

import type { Button as BaseButtonNS } from '@base-ui/react/button'
import type { VariantProps } from 'class-variance-authority'
import { Button as BaseButton } from '@base-ui/react/button'
import * as React from 'react'
import { cn } from '../cn'
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

type IconButtonProps = Omit<
  BaseButtonNS.Props,
  'aria-label' | 'aria-labelledby' | 'children' | 'className'
> &
  AccessibleName &
  VariantProps<typeof iconButtonVariants> & {
    children: React.ReactElement
    className?: string
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
      className={cn(iconButtonVariants({ variant, tone, size }), className)}
      {...props}
    >
      {children}
    </BaseButton>
  )
}

export { IconButton }

export type { IconButtonProps }
