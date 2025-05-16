import type { FC } from 'react'
import { WEB_PREFIX } from '@/config'

type LogoEmbeddedChatAvatarProps = {
  className?: string
}
const LogoEmbeddedChatAvatar: FC<LogoEmbeddedChatAvatarProps> = ({
  className,
}) => {
  return (
    <img
      src={`${WEB_PREFIX}/logo/logo-embedded-chat-avatar.png`}
      className={`block h-10 w-10 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbeddedChatAvatar
