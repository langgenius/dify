import type { ImageLoadingStatus } from '@base-ui/react/avatar'
import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import { cn } from '@langgenius/dify-ui/cn'

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
  onLoadingStatusChange?: (status: ImageLoadingStatus) => void
}

type AvatarRootProps = BaseAvatar.Root.Props & {
  size?: AvatarSize
}

export function AvatarRoot({
  size = 'md',
  className,
  ...props
}: AvatarRootProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-600 select-none',
        avatarSizeClasses[size].root,
        className,
      )}
      {...props}
    />
  )
}

type AvatarFallbackProps = BaseAvatar.Fallback.Props & {
  size?: AvatarSize
}

export function AvatarFallback({
  size = 'md',
  className,
  ...props
}: AvatarFallbackProps) {
  return (
    <BaseAvatar.Fallback
      className={cn(
        'flex size-full items-center justify-center font-medium text-white',
        avatarSizeClasses[size].text,
        className,
      )}
      {...props}
    />
  )
}

type AvatarImageProps = BaseAvatar.Image.Props

export function AvatarImage({
  className,
  ...props
}: AvatarImageProps) {
  return (
    <BaseAvatar.Image
      className={cn('absolute inset-0 size-full object-cover', className)}
      {...props}
    />
  )
}

export const Avatar = ({
  name,
  avatar,
  size = 'md',
  className,
  onLoadingStatusChange,
}: AvatarProps) => {
  return (
    <AvatarRoot size={size} className={className}>
      {avatar && (
        <AvatarImage
          src={avatar}
          alt={name}
          onLoadingStatusChange={onLoadingStatusChange}
        />
      )}
      <AvatarFallback size={size}>
        {name?.[0]?.toLocaleUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}
