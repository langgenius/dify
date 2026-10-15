import type { AvatarProps, AvatarSize } from '@langgenius/dify-ui/avatar'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'

const avatarColors = [
  'bg-components-icon-bg-blue-solid',
  'bg-components-icon-bg-blue-light-solid',
  'bg-components-icon-bg-indigo-solid',
  'bg-components-icon-bg-violet-solid',
  'bg-components-icon-bg-green-solid',
  'bg-components-icon-bg-teal-solid',
  'bg-components-icon-bg-pink-solid',
  'bg-components-icon-bg-orange-dark-solid',
  'bg-components-icon-bg-red-solid',
  'bg-components-icon-bg-orange-solid',
  'bg-components-icon-bg-midnight-solid',
] as const

type RecipientAvatarProps = Pick<AvatarProps, 'avatar' | 'name' | 'className'> & {
  identity: string
  size: Extract<AvatarSize, 'xxs' | 'sm' | 'xl'>
}

export function RecipientAvatar({ identity, avatar, name, size, className }: RecipientAvatarProps) {
  const colorIndex = [...identity].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    0,
  )

  return (
    <AvatarRoot
      size={size}
      className={cn(
        'inset-ring-[0.5px] inset-ring-divider-regular',
        avatarColors[colorIndex % avatarColors.length],
        className,
      )}
    >
      {avatar && <AvatarImage key={avatar.split('?')[0]} keepMounted src={avatar} alt={name} />}
      <AvatarFallback
        size={size}
        className={cn(
          'bg-linear-to-br from-components-avatar-bg-mask-stop-0 to-components-avatar-bg-mask-stop-100 leading-[1.2]',
          size === 'xxs'
            ? 'text-[10px]'
            : size === 'sm'
              ? 'text-[13px] font-semibold'
              : 'text-lg font-semibold',
        )}
      >
        <span className="bg-linear-to-b from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text text-transparent opacity-90 text-shadow-[0_0.25px_0.5px_rgb(0_0_0/0.2)]">
          {name[0]?.toLocaleUpperCase()}
        </span>
      </AvatarFallback>
    </AvatarRoot>
  )
}
