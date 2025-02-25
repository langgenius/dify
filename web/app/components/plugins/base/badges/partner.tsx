import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import IconWithTooltip from './icon-with-tooltip'
import PartnerDark from '@/app/components/base/icons/src/public/plugins/PartnerDark'
import PartnerLight from '@/app/components/base/icons/src/public/plugins/PartnerLight'
import useTheme from '@/hooks/use-theme'

type PartnerProps = {
  className?: string
}

const Partner: FC<PartnerProps> = ({
  className,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  return (
    <IconWithTooltip
      className={className}
      theme={theme}
      BadgeIconLight={PartnerLight}
      BadgeIconDark={PartnerDark}
      popupContent={t('plugin.marketplace.partnerTip')}
    />
  )
}

export default Partner
