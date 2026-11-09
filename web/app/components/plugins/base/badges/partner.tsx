'use client'

import type { FC } from 'react'
import IconWithTooltip from './icon-with-tooltip'

type PartnerProps = {
  className?: string
  text: string
}

const Partner: FC<PartnerProps> = ({ className, text }) => {
  return (
    <IconWithTooltip
      className={className}
      lightIconClassName={'i-custom-public-plugins-partner-light'}
      darkIconClassName={'i-custom-public-plugins-partner-dark'}
      popupContent={text}
    />
  )
}

export default Partner
