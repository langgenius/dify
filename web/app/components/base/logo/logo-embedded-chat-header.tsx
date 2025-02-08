import type { FC } from 'react'

type LogoEmbeddedChatHeaderProps = {
  className?: string
}

const LogoEmbeddedChatHeader: FC<LogoEmbeddedChatHeaderProps> = ({
  className,
}) => {
  return (
    <img
      src={`${process.env.NEXT_PUBLIC_BASE_PATH}/logo/logo-embedded-chat-header.png`}
      className={`block w-auto h-6 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbeddedChatHeader
