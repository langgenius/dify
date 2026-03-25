import type { ImageLoadingStatus } from '@base-ui/react/avatar'
import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import { cn } from '@/utils/classnames'

const SIZES = {
  'xxs': { root: 'size-4', text: 'text-[7px]' },
  'xs': { root: 'size-5', text: 'text-[8px]' },
  'sm': { root: 'size-6', text: 'text-[10px]' },
  'md': { root: 'size-8', text: 'text-xs' },
  'lg': { root: 'size-9', text: 'text-sm' },
  'xl': { root: 'size-10', text: 'text-base' },
  '2xl': { root: 'size-12', text: 'text-xl' },
  '3xl': { root: 'size-16', text: 'text-2xl' },
} as const

export type AvatarSize = keyof typeof SIZES

export type AvatarProps = {
  name: string
  avatar: string | null
  size?: AvatarSize
  className?: string
  onLoadingStatusChange?: (status: ImageLoadingStatus) => void
}

const BASE_CLASS = 'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary-600'

export const Avatar = ({
  name,
  avatar,
  size = 'md',
  className,
  onLoadingStatusChange,
}: AvatarProps) => {
  const sizeConfig = SIZES[size]

  return (
    <BaseAvatar.Root className={cn(BASE_CLASS, sizeConfig.root, className)}>
      {avatar && (
        <BaseAvatar.Image
          src={avatar}
          alt={name}
          className="absolute inset-0 size-full object-cover"
          onLoadingStatusChange={onLoadingStatusChange}
        />
      )}
      <BaseAvatar.Fallback className={cn('font-medium text-white', sizeConfig.text)}>
        {name?.[0]?.toLocaleUpperCase()}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  )
}
