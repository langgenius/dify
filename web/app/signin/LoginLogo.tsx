'use client'
import type { FC } from 'react'
import classNames from '@/utils/classnames'
import { useSelector } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'

type LoginLogoProps = {
  className?: string
}

const LoginLogo: FC<LoginLogoProps> = ({
  className,
}) => {
  const { systemFeatures } = useGlobalPublicStore()
  const { theme } = useSelector((s) => {
    return {
      theme: s.theme,
    }
  })

  let src = theme === 'light' ? '/logo/logo-site.png' : `/logo/logo-site-${theme}.png`
  if (systemFeatures.branding.enabled)
    src = systemFeatures.branding.login_page_logo

  return (
    <img
      src={src}
      className={classNames('block w-auto h-10', className)}
      alt='logo'
    />
  )
}

export default LoginLogo
