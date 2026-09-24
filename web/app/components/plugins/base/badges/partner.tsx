'use client'

import type { FC } from 'react'
import useTheme from '@/hooks/use-theme'
import IconWithTooltip from './icon-with-tooltip'

type PartnerProps = {
  className?: string
  text: string
}

const Partner: FC<PartnerProps> = ({ className, text }) => {
  const { theme } = useTheme()

  return (
    <IconWithTooltip
      className={className}
      theme={theme}
      lightIconClassName={'i-custom-public-plugins-partner-light'}
      darkIconClassName={'i-custom-public-plugins-partner-dark'}
      popupContent={text}
    />
  )
}

export default Partner
