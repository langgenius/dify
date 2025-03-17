import type { FC } from 'react'
import { basePath } from '@/utils/var'

type LogoEmbeddedChatHeaderProps = {
  className?: string
}

const LogoEmbeddedChatHeader: FC<LogoEmbeddedChatHeaderProps> = ({
  className,
}) => {
  return (
    <img
      src={basePath + '/logo/logo-embedded-chat-header.png'}
      className={`block w-auto h-6 ${className}`}
      alt='logo'
    />
  )
}

export default LogoEmbeddedChatHeader
