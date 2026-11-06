import type { FC } from 'react'
import IconWithTooltip from './icon-with-tooltip'

type VerifiedProps = {
  className?: string
  text: string
}

const Verified: FC<VerifiedProps> = ({ className, text }) => {
  return (
    <IconWithTooltip
      className={className}
      lightIconClassName={'i-custom-public-plugins-verified-light'}
      darkIconClassName={'i-custom-public-plugins-verified-dark'}
      popupContent={text}
    />
  )
}

export default Verified
