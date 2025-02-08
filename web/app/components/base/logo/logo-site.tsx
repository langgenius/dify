'use client'
import type { FC } from 'react'
import classNames from '@/utils/classnames'
import { useSelector } from '@/context/app-context'
import { BASE_PATH } from '@/config'

type LogoSiteProps = {
  className?: string
}

const LogoSite: FC<LogoSiteProps> = ({
  className,
}) => {
  const { theme } = useSelector((s) => {
    return {
      theme: s.theme,
    }
  })

  const src = theme === 'light' ? `${BASE_PATH}/logo/logo-site.png` : `${BASE_PATH}/logo/logo-site-${theme}.png`
  return (
    <img
      src={src}
      className={classNames('block w-auto h-10', className)}
      alt='logo'
    />
  )
}

export default LogoSite
