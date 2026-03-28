import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { cn } from '@/utils/classnames'

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

export const CredentialIcon: React.FC<CredentialIconProps> = ({
  avatarUrl,
  name,
  size = 20,
  className = '',
}) => {
  const [showAvatar, setShowAvatar] = useState(!!avatarUrl && avatarUrl !== 'default')
  const firstLetter = useMemo(() => name.charAt(0).toUpperCase(), [name])
  const bgColor = useMemo(() => ICON_BG_COLORS[firstLetter.charCodeAt(0) % ICON_BG_COLORS.length], [firstLetter])

  const onImgLoadError = useCallback(() => {
    setShowAvatar(false)
  }, [])

  if (avatarUrl && avatarUrl !== 'default' && showAvatar) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-divider-regular',
          className,
        )}
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <img
          src={avatarUrl}
          width={size}
          height={size}
          className="shrink-0 object-contain"
          onError={onImgLoadError}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border border-divider-regular',
        bgColor,
        className,
      )}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <span className="bg-gradient-to-b from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text text-[13px] font-semibold leading-[1.2] text-transparent opacity-90">
        {firstLetter}
      </span>
    </div>
  )
}
