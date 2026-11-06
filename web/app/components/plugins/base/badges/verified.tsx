import type { FC } from 'react'
import { useResolvedTheme } from '@/features/theme/hooks'
import IconWithTooltip from './icon-with-tooltip'

type VerifiedProps = {
  className?: string
  text: string
}

const Verified: FC<VerifiedProps> = ({ className, text }) => {
  const theme = useResolvedTheme()

  return (
    <IconWithTooltip
      className={className}
      theme={theme}
      lightIconClassName={'i-custom-public-plugins-verified-light'}
      darkIconClassName={'i-custom-public-plugins-verified-dark'}
      popupContent={text}
    />
  )
}

export default Verified
