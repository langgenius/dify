'use client'
import type { FC } from 'react'
import { basePath } from '@/utils/var'
import classNames from '@/utils/classnames'
import { useGlobalPublicStore } from '@/context/global-public-context'

type LogoSiteProps = {
  className?: string
}

const LogoSite: FC<LogoSiteProps> = ({
  className,
}) => {
  const { systemFeatures } = useGlobalPublicStore()

  let src = `${basePath}/logo/logo.png`
  if (systemFeatures.branding.enabled)
    src = systemFeatures.branding.workspace_logo

  return (
    <img
      src={src}
      className={classNames('block w-[22.651px] h-[24.5px]', className)}
      alt='logo'
    />
  )
}

export default LogoSite
