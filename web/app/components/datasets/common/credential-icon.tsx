import cn from '@/utils/classnames'
import React, { useCallback, useMemo, useState } from 'react'

type CredentialIconProps = {
  avatar_url?: string
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
  avatar_url,
  name,
  size = 20,
  className = '',
}) => {
  const [showAvatar, setShowAvatar] = useState(!!avatar_url && avatar_url !== 'default')
  const firstLetter = useMemo(() => name.charAt(0).toUpperCase(), [name])
  const bgColor = useMemo(() => ICON_BG_COLORS[firstLetter.charCodeAt(0) % ICON_BG_COLORS.length], [firstLetter])

  const onImgLoadError = useCallback(() => {
    setShowAvatar(false)
  }, [])

  if (avatar_url && avatar_url !== 'default' && showAvatar) {
    return (
      <div
        className='flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-divider-regular'
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <img
          src={avatar_url}
          width={size}
          height={size}
          className={cn('shrink-0 object-contain', className)}
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
      <span className='bg-gradient-to-b from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text text-[13px] font-semibold leading-[1.2] text-transparent opacity-90'>
        {firstLetter}
      </span>
    </div>
  )
}
