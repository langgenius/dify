'use client'
import type { FC } from 'react'
import classNames from '@/utils/classnames'

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
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
  const src = basePath + (theme === 'light' ? '/logo/logo-site.png' : `/logo/logo-site-${theme}.png`)
  return (
    <img
      src={'/logo/logo.png'}
      className={classNames('block w-[22.651px] h-[24.5px]', className)}
      alt='logo'
    />
  )
}

export default LogoSite
