import React, { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import Wrapper from './wrapper'
import VerifiedDark from '@/app/components/base/icons/src/public/plugins/VerifiedDark'
import VerifiedLight from '@/app/components/base/icons/src/public/plugins/VerifiedLight'

type VerifiedProps = {
  className?: string
}

const Verified: FC<VerifiedProps> = ({
  className,
}) => {
  const { t } = useTranslation()

  return (
    <Wrapper
      className={className}
      BadgeIconLight={VerifiedLight}
      BadgeIconDark={VerifiedDark}
      popupContent={t('plugin.marketplace.verifiedTip')}
    />
  )
}

export default React.memo(Verified)
