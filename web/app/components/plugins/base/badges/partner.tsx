'use client'

import type { FC } from 'react'
import { useResolvedTheme } from '@/features/theme/hooks'
import IconWithTooltip from './icon-with-tooltip'

type PartnerProps = {
  className?: string
  text: string
}

const Partner: FC<PartnerProps> = ({ className, text }) => {
  const theme = useResolvedTheme()

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
