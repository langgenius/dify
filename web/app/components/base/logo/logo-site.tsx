import type { FC } from 'react'
import Image from 'next/image'

type LogoSiteProps = {
  className?: string
}
const LogoSite: FC<LogoSiteProps> = ({
  className,
}) => {
  return (
    <Image
      src='/logo/logo-site.png'
      className={`w-auto h-10 ${className}`}
      alt='logo'
    />
  )
}

export default LogoSite
