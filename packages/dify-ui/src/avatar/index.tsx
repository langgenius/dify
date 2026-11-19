'use client'

import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import { resolveClassName } from '../internal/resolve-class-name'

const avatarSizeVariants = cva('', {
  variants: {
    size: {
      xxs: '[--avatar-font-size:7px] [--avatar-size:--spacing(4)]',
      xs: '[--avatar-font-size:8px] [--avatar-size:--spacing(5)]',
      sm: '[--avatar-font-size:10px] [--avatar-size:--spacing(6)]',
      md: '[--avatar-font-size:var(--text-xs)] [--avatar-size:--spacing(8)]',
      lg: '[--avatar-font-size:var(--text-sm)] [--avatar-size:--spacing(9)]',
      xl: '[--avatar-font-size:var(--text-base)] [--avatar-size:--spacing(10)]',
      '2xl': '[--avatar-font-size:var(--text-xl)] [--avatar-size:--spacing(12)]',
      '3xl': '[--avatar-font-size:var(--text-2xl)] [--avatar-size:--spacing(16)]',
    },
  },
})

const avatarClassName =
  'relative inline-flex size-[var(--avatar-size,--spacing(8))] shrink-0 items-center justify-center overflow-hidden rounded-full align-middle text-[length:var(--avatar-font-size,var(--text-xs))] ring-components-panel-bg select-none group-[&]/avatar-group:ring-1'

type AvatarSize = NonNullable<VariantProps<typeof avatarSizeVariants>['size']>
type AvatarProps = BaseAvatar.Root.Props & { size?: AvatarSize }

function Avatar({ size, className, ...props }: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={(state) =>
        cn(avatarClassName, avatarSizeVariants({ size }), resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type AvatarFallbackProps = BaseAvatar.Fallback.Props

function AvatarFallback({ className, ...props }: AvatarFallbackProps) {
  return (
    <BaseAvatar.Fallback
      className={(state) =>
        cn(
          'absolute inset-0 flex size-full items-center justify-center bg-primary-600 font-medium text-white',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type AvatarImageProps = BaseAvatar.Image.Props

function AvatarImage({ className, ...props }: AvatarImageProps) {
  return (
    <BaseAvatar.Image
      className={(state) =>
        cn(
          'absolute inset-0 size-full object-cover data-error:invisible data-loading:invisible',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type AvatarGroupProps = React.ComponentProps<'span'> & { size?: AvatarSize }

function AvatarGroup({ size, className, ...props }: AvatarGroupProps) {
  return (
    <span
      className={cn(
        'group/avatar-group isolate inline-flex items-center -space-x-1 align-middle',
        avatarSizeVariants({ size }),
        className,
      )}
      {...props}
    />
  )
}

type AvatarGroupCountProps = React.ComponentProps<'span'> & { size?: AvatarSize }

function AvatarGroupCount({ size, className, children, ...props }: AvatarGroupCountProps) {
  return (
    <span
      className={cn(
        avatarClassName,
        avatarSizeVariants({ size }),
        'bg-components-icon-bg-midnight-solid',
        className,
      )}
      {...props}
    >
      <span className="bg-linear-to-b from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text font-semibold text-transparent opacity-90">
        {children}
      </span>
    </span>
  )
}

export { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage }
export type {
  AvatarFallbackProps,
  AvatarGroupCountProps,
  AvatarGroupProps,
  AvatarImageProps,
  AvatarProps,
  AvatarSize,
}
