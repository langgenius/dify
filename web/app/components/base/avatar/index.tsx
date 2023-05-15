'use client'
import cn from 'classnames'

interface IAvatarProps {
  name: string
  avatar?: string
  size?: number
  className?: string
}
const Avatar = ({
  name,
  avatar,
  size = 30,
  className
}: IAvatarProps) => {
  const avatarClassName = `shrink-0 flex items-center rounded-full bg-primary-600`
  const style = { width: `${size}px`, height:`${size}px`, fontSize: `${size}px`, lineHeight: `${size}px` }

  if (avatar) {
    return (
      <img 
        className={cn(avatarClassName, className)} 
        style={style}
        alt={name} 
        src={avatar}
      />
    )
  }

  return (
    <div 
      className={cn(avatarClassName, className)} 
      style={style}
    >
      <div 
        className={`text-center text-white scale-[0.4]`} 
        style={style}
      >
        {name[0].toLocaleUpperCase()}
      </div>
    </div>
  )
}

export default Avatar