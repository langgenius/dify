import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { basePath } from '@/utils/var'

type LogoEmbeddedChatHeaderProps = {
  className?: string
}

const LogoEmbeddedChatHeader: FC<LogoEmbeddedChatHeaderProps> = ({
  className,
}) => {
  return (
    <img
      src={`${basePath}/logo/login_dg.png`}
      alt="logo"
      className={cn('block h-6 w-auto', className)}
    />
  )
}

export default LogoEmbeddedChatHeader
