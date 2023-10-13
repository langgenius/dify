import type { FC } from 'react'
import Image from 'next/image'

type LogoEmbededChatAvatarProps = {
  className?: string
}
const LogoEmbededChatAvatar: FC<LogoEmbededChatAvatarProps> = ({
  className,
}) => {
  return (
    <Image
      src='/logo/logo-embeded-chat-avatar.png'
      className={`w-10 h-10 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbededChatAvatar
