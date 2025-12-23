import type { FC } from 'react'
import PartnerDark from '@/app/components/base/icons/src/public/plugins/PartnerDark'
import PartnerLight from '@/app/components/base/icons/src/public/plugins/PartnerLight'
import useTheme from '@/hooks/use-theme'
import IconWithTooltip from './icon-with-tooltip'

type PartnerProps = {
  className?: string
  text: string
}

const Partner: FC<PartnerProps> = ({
  className,
  text,
}) => {
  const { theme } = useTheme()

  return (
    <IconWithTooltip
      className={className}
      theme={theme}
      BadgeIconLight={PartnerLight}
      BadgeIconDark={PartnerDark}
      popupContent={text}
    />
  )
}

export default Partner
