import type { FC } from 'react'

type LogoSiteProps = {
  className?: string
}
const LogoSite: FC<LogoSiteProps> = ({
  className,
}) => {
  return (
    <img
      src='/logo/logo-site.png'
      className={`block w-auto h-10 ${className}`}
      alt='logo'
    />
  )
}

export default LogoSite
