'use client'
import type { FC } from 'react'
import { basePath } from '@/utils/var'
import classNames from '@/utils/classnames'

type LogoSiteProps = {
  className?: string
}

const LogoSite: FC<LogoSiteProps> = ({
  className,
}) => {
  return (
    <img
      src={`${basePath}/logo/logo.png`}
      className={classNames('block h-[24.5px] w-[22.651px]', className)}
      alt='logo'
    />
  )
}

export default LogoSite
