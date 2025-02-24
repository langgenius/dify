import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import BadgeWithTooltip from './badge-with-tooltip'
import PartnerDark from '@/app/components/base/icons/src/public/plugins/PartnerDark'
import PartnerLight from '@/app/components/base/icons/src/public/plugins/PartnerLight'

type PartnerProps = {
  className?: string
}

const Partner: FC<PartnerProps> = ({
  className,
}) => {
  const { t } = useTranslation()

  return (
    <BadgeWithTooltip
      className={className}
      BadgeIconLight={PartnerLight}
      BadgeIconDark={PartnerDark}
      popupContent={t('plugin.marketplace.partnerTip')}
    />
  )
}

export default React.memo(Partner)
