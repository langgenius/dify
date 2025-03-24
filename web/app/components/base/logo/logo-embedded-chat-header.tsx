import type { FC } from 'react'

type LogoEmbeddedChatHeaderProps = {
  className?: string
}

const LogoEmbeddedChatHeader: FC<LogoEmbeddedChatHeaderProps> = ({
  className,
}) => {
  return (
    <img
      src='/logo/logo-embedded-chat-header.png'
      className={`block h-6 w-auto ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbeddedChatHeader
