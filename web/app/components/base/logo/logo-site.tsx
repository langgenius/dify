import type { FC } from 'react'

type LogoSiteProps = {
  className?: string
}
const LogoSite: FC<LogoSiteProps> = ({
  className,
}) => {
  return (
    <img
      src='https://my-buddy.ai/wp-content/uploads/2024/01/dark-logo.png'
      className={`block w-auto h-10 ${className}`}
      alt='logo'
    />
  )
}

export default LogoSite
