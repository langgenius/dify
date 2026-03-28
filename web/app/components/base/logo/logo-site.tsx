'use client'
import type { FC } from 'react'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'

type LogoSiteProps = {
  className?: string
}

const LogoSite: FC<LogoSiteProps> = ({
  className,
}) => {
  return (
    <img
      src={`${basePath}/logo/logo.png`}
      className={cn('block h-[24.5px] w-[22.651px]', className)}
      alt="logo"
    />
  )
}

export default LogoSite
