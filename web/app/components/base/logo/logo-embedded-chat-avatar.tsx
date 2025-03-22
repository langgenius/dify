import type { FC } from 'react'

type LogoEmbeddedChatAvatarProps = {
  className?: string
}
const LogoEmbeddedChatAvatar: FC<LogoEmbeddedChatAvatarProps> = ({
  className,
}) => {
  return (
    <img
      src='/logo/logo-embedded-chat-avatar.png'
      className={`block h-10 w-10 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbeddedChatAvatar
