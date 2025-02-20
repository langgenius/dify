import type { FC } from 'react'
import { BASE_PATH } from '@/config'

type LogoEmbeddedChatAvatarProps = {
  className?: string
}
const LogoEmbeddedChatAvatar: FC<LogoEmbeddedChatAvatarProps> = ({
  className,
}) => {
  return (
    <img
      src={`${BASE_PATH}/logo/logo-embedded-chat-avatar.png`}
      className={`block w-10 h-10 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbeddedChatAvatar
