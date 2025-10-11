'use client'
import { useEffect, useState } from 'react'
import cn from '@/utils/classnames'

export type AvatarProps = {
  name: string
  avatar: string | null
  size?: number
  className?: string
  textClassName?: string
  onError?: (x: boolean) => void
  backgroundColor?: string
}
const Avatar = ({
  name,
  avatar,
  size = 30,
  className,
  textClassName,
  onError,
  backgroundColor,
}: AvatarProps) => {
  const avatarClassName = backgroundColor
    ? 'shrink-0 flex items-center rounded-full'
    : 'shrink-0 flex items-center rounded-full bg-primary-600'
  const style = {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${size}px`,
    lineHeight: `${size}px`,
    ...(backgroundColor && !avatar ? { backgroundColor } : {}),
  }
  const [imgError, setImgError] = useState(false)

  const handleError = () => {
    setImgError(true)
    onError?.(true)
  }

  // after uploaded, api would first return error imgs url: '.../files//file-preview/...'. Then return the right url, Which caused not show the avatar
  useEffect(() => {
    if(avatar && imgError)
      setImgError(false)
  }, [avatar])

  if (avatar && !imgError) {
    return (
      <span
        className={cn(avatarClassName, className)}
        style={style}
      >
        <img
          className='h-full w-full rounded-full object-cover'
          alt={name}
          src={avatar}
          onError={handleError}
          onLoad={() => onError?.(false)}
        />
      </span>
    )
  }

  return (
    <div
      className={cn(avatarClassName, className)}
      style={style}
    >
      <div
        className={cn(textClassName, 'scale-[0.4] text-center text-white')}
        style={style}
      >
        {name && name[0].toLocaleUpperCase()}
      </div>
    </div>
  )
}

export default Avatar
