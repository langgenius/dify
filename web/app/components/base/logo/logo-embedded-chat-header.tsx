import classNames from '@/utils/classnames'
import type { FC } from 'react'
import { basePath } from '@/utils/var'

type LogoEmbeddedChatHeaderProps = {
  className?: string
}

const LogoEmbeddedChatHeader: FC<LogoEmbeddedChatHeaderProps> = ({
  className,
}) => {
  return <picture>
    <source media="(resolution: 1x)" srcSet='/logo/logo-embedded-chat-header.png' />
    <source media="(resolution: 2x)" srcSet='/logo/logo-embedded-chat-header@2x.png' />
    <source media="(resolution: 3x)" srcSet='/logo/logo-embedded-chat-header@3x.png' />
    <img
      src={`${basePath}/logo/logo-embedded-chat-header.png`}
      alt='logo'
      className={classNames('block h-6 w-auto', className)}
    />
  </picture>
}

export default LogoEmbeddedChatHeader
