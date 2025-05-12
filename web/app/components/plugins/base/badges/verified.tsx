import type { FC } from 'react'
import IconWithTooltip from './icon-with-tooltip'
import VerifiedDark from '@/app/components/base/icons/src/public/plugins/VerifiedDark'
import VerifiedLight from '@/app/components/base/icons/src/public/plugins/VerifiedLight'
import useTheme from '@/hooks/use-theme'

type VerifiedProps = {
  className?: string
  text: string
}

const Verified: FC<VerifiedProps> = ({
  className,
  text,
}) => {
  const { theme } = useTheme()

  return (
    <IconWithTooltip
      className={className}
      theme={theme}
      BadgeIconLight={VerifiedLight}
      BadgeIconDark={VerifiedDark}
      popupContent={text}
    />
  )
}

export default Verified
