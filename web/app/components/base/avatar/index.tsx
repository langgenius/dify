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
}
const Avatar = ({
  name,
  avatar,
  size = 30,
  className,
  textClassName,
  onError,
}: AvatarProps) => {
  const avatarClassName = 'shrink-0 flex items-center rounded-full bg-primary-600'
  const style = { width: `${size}px`, height: `${size}px`, fontSize: `${size}px`, lineHeight: `${size}px` }
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
      <img
        className={cn(avatarClassName, className)}
        style={style}
        alt={name}
        src={avatar}
        onError={handleError}
        onLoad={() => onError?.(false)}
      />
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
