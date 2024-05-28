import type { FC } from 'react'

type LogoEmbededChatHeaderProps = {
  className?: string
}
const LogoEmbededChatHeader: FC<LogoEmbededChatHeaderProps> = ({
  className,
}) => {
  return (
    <img
      src='/logo/logo-embeded-chat-header.png'
      className={`block w-auto h-6 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbededChatHeader
