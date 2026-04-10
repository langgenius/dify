import type { ImageLoadingStatus } from '@base-ui/react/avatar'
import type * as React from 'react'
import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import { cn } from '@/utils/classnames'

const avatarSizeClasses = {
  'xxs': { root: 'size-4', text: 'text-[7px]' },
  'xs': { root: 'size-5', text: 'text-[8px]' },
  'sm': { root: 'size-6', text: 'text-[10px]' },
  'md': { root: 'size-8', text: 'text-xs' },
  'lg': { root: 'size-9', text: 'text-sm' },
  'xl': { root: 'size-10', text: 'text-base' },
  '2xl': { root: 'size-12', text: 'text-xl' },
  '3xl': { root: 'size-16', text: 'text-2xl' },
} as const

export type AvatarSize = keyof typeof avatarSizeClasses

export type AvatarProps = {
  name: string
  avatar: string | null
  size?: AvatarSize
  className?: string
  textClassName?: string
  onError?: (hasError: boolean) => void
  backgroundColor?: string
  onLoadingStatusChange?: (status: ImageLoadingStatus) => void
}

type AvatarRootProps = React.ComponentPropsWithRef<typeof BaseAvatar.Root> & {
  size?: AvatarSize
  hasAvatar?: boolean
  backgroundColor?: string
}

function AvatarRoot({
  size = 'md',
  className,
  hasAvatar = false,
  backgroundColor,
  style,
  ...props
}: AvatarRootProps) {
  const resolvedStyle: React.CSSProperties = {
    ...(backgroundColor && !hasAvatar ? { backgroundColor } : {}),
    ...style,
  }

  return (
    <BaseAvatar.Root
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-600 select-none',
        avatarSizeClasses[size].root,
        className,
      )}
      style={resolvedStyle}
      {...props}
    />
  )
}

type AvatarFallbackProps = React.ComponentPropsWithRef<typeof BaseAvatar.Fallback> & {
  size?: AvatarSize
  textClassName?: string
}

function AvatarFallback({
  size = 'md',
  textClassName,
  className,
  style,
  ...props
}: AvatarFallbackProps) {
  const resolvedStyle: React.CSSProperties = {
    ...style,
  }

  return (
    <BaseAvatar.Fallback
      className={cn(
        'flex size-full items-center justify-center font-medium text-white',
        avatarSizeClasses[size].text,
        textClassName,
        className,
      )}
      style={resolvedStyle}
      {...props}
    />
  )
}

type AvatarImageProps = React.ComponentPropsWithRef<typeof BaseAvatar.Image>

function AvatarImage({
  className,
  ...props
}: AvatarImageProps) {
  return (
    <BaseAvatar.Image
      className={cn('inset-0 absolute size-full object-cover', className)}
      {...props}
    />
  )
}

export const Avatar = ({
  name,
  avatar,
  size = 'md',
  className,
  textClassName,
  onError,
  backgroundColor,
  onLoadingStatusChange,
}: AvatarProps) => {
  const handleLoadingStatusChange = (status: ImageLoadingStatus) => {
    onLoadingStatusChange?.(status)
    if (status === 'error')
      onError?.(true)
    if (status === 'loaded')
      onError?.(false)
  }

  return (
    <AvatarRoot
      size={size}
      className={className}
      backgroundColor={backgroundColor}
      hasAvatar={Boolean(avatar)}
    >
      {avatar && (
        <AvatarImage
          src={avatar}
          alt={name}
          onLoadingStatusChange={handleLoadingStatusChange}
        />
      )}
      <AvatarFallback size={size} textClassName={textClassName}>
        {name?.[0]?.toLocaleUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}

export default Avatar
