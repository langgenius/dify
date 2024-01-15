import type { FC } from 'react'

type AvatarProps = {
  className?: string
}
const Avatar: FC<AvatarProps> = ({
  className,
}) => {
  return (
    <div className={`w-10 h-10 rounded-3xl border-[0.5px] border-black/5 ${className}`}>
    </div>
  )
}

export default Avatar
