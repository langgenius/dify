import type { FC } from 'react'
import Image from 'next/image'

type LogoEmbededChatHeaderProps = {
  className?: string
}
const LogoEmbededChatHeader: FC<LogoEmbededChatHeaderProps> = ({
  className,
}) => {
  return (
    <Image
      src='/logo/logo-embeded-chat-header.png'
      className={`w-auto h-6 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbededChatHeader
