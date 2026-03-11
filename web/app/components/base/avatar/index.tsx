import type { ImageLoadingStatus } from '@base-ui/react/avatar'
import type { VariantProps } from 'class-variance-authority'
import { Avatar as BaseAvatar } from '@base-ui/react/avatar'
import { cva } from 'class-variance-authority'
import { cn } from '@/utils/classnames'

export const avatarVariants = cva(
  'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary-600',
  {
    variants: {
      size: {
        'xxs': 'size-4',
        'xs': 'size-5',
        'sm': 'size-6',
        'md': 'size-8',
        'lg': 'size-9',
        'xl': 'size-10',
        '2xl': 'size-12',
        '3xl': 'size-16',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

const fallbackTextVariants = cva(
  'font-medium text-white',
  {
    variants: {
      size: {
        'xxs': 'text-[7px]',
        'xs': 'text-[8px]',
        'sm': 'text-[10px]',
        'md': 'text-xs',
        'lg': 'text-sm',
        'xl': 'text-base',
        '2xl': 'text-xl',
        '3xl': 'text-2xl',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

export type AvatarProps = {
  name: string
  avatar: string | null
  className?: string
  onLoadingStatusChange?: (status: ImageLoadingStatus) => void
} & VariantProps<typeof avatarVariants>

export const Avatar = ({
  name,
  avatar,
  size,
  className,
  onLoadingStatusChange,
}: AvatarProps) => {
  return (
    <BaseAvatar.Root className={cn(avatarVariants({ size }), className)}>
      {avatar && (
        <BaseAvatar.Image
          src={avatar}
          alt={name}
          className="absolute inset-0 size-full object-cover"
          onLoadingStatusChange={onLoadingStatusChange}
        />
      )}
      <BaseAvatar.Fallback className={fallbackTextVariants({ size })}>
        {name?.[0]?.toLocaleUpperCase()}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  )
}
