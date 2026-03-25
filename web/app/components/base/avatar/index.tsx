import type { ImageLoadingStatus } from '@base-ui/react/avatar'
import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import { cn } from '@/utils/classnames'

export const avatarSizeClasses = {
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

export const getAvatarSizeClassNames = (size: AvatarSize) => avatarSizeClasses[size]

export type AvatarProps = {
  name: string
  avatar: string | null
  size?: AvatarSize
  className?: string
  onLoadingStatusChange?: (status: ImageLoadingStatus) => void
}

export const AvatarRoot = BaseAvatar.Root
export const AvatarImage = BaseAvatar.Image
export const AvatarFallback = BaseAvatar.Fallback

export const avatarPartClassNames = {
  root: 'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary-600',
  image: 'absolute inset-0 size-full object-cover',
  fallback: 'flex size-full items-center justify-center font-medium text-white',
} as const

export const Avatar = ({
  name,
  avatar,
  size = 'md',
  className,
  onLoadingStatusChange,
}: AvatarProps) => {
  const sizeClassNames = getAvatarSizeClassNames(size)

  return (
    <AvatarRoot className={cn(avatarPartClassNames.root, sizeClassNames.root, className)}>
      {avatar && (
        <AvatarImage
          src={avatar}
          alt={name}
          className={avatarPartClassNames.image}
          onLoadingStatusChange={onLoadingStatusChange}
        />
      )}
      <AvatarFallback className={cn(avatarPartClassNames.fallback, sizeClassNames.text)}>
        {name?.[0]?.toLocaleUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}
