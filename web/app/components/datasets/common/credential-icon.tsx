import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { getAvatarInitial } from '@/utils/avatar'

type CredentialIconProps = {
  avatarUrl?: string
  name: string
  size?: number
  className?: string
}

const ICON_BG_COLORS = [
  'bg-components-icon-bg-orange-dark-solid',
  'bg-components-icon-bg-pink-solid',
  'bg-components-icon-bg-indigo-solid',
  'bg-components-icon-bg-teal-solid',
]

export function CredentialIcon({ avatarUrl, name, size = 20, className }: CredentialIconProps) {
  const initial = getAvatarInitial(name)
  const bgColor = ICON_BG_COLORS[initial.codePointAt(0)! % ICON_BG_COLORS.length]

  return (
    <Avatar
      aria-hidden="true"
      className={cn('rounded-md border border-divider-regular', className)}
      style={{ width: size, height: size }}
    >
      <AvatarFallback className={bgColor}>
        <span className="bg-linear-to-b from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text text-[13px] leading-[1.2] font-semibold text-transparent opacity-90">
          {initial}
        </span>
      </AvatarFallback>
      <AvatarImage
        keepMounted
        src={avatarUrl && avatarUrl !== 'default' ? avatarUrl : undefined}
        alt=""
        width={size}
        height={size}
        className="object-contain"
      />
    </Avatar>
  )
}
