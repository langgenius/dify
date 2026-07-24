'use client'

import { RiHourglass2Fill } from '@remixicon/react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { LicenseStatus } from '@/types/feature'
import PremiumBadge from '../../base/premium-badge'

const LicenseNav = () => {
  const { t } = useTranslation()
  const { systemFeatures } = useGlobalPublicStore()

  if (systemFeatures.license?.status === LicenseStatus.EXPIRING) {
    const expiredAt = systemFeatures.license?.expired_at
    const count = dayjs(expiredAt).diff(dayjs(), 'days')
    return (
      <PremiumBadge color="orange" className="select-none">
        <RiHourglass2Fill className="flex size-3 items-center pl-0.5 text-components-premium-badge-indigo-text-stop-0" />
        {count <= 1 && <span className="system-xs-medium px-0.5">{t('license.expiring', { ns: 'common', count })}</span>}
        {count > 1 && <span className="system-xs-medium px-0.5">{t('license.expiring_plural', { ns: 'common', count })}</span>}
      </PremiumBadge>
    )
  }
  if (systemFeatures.license.status === LicenseStatus.ACTIVE) {
    return (
      <PremiumBadge color="indigo" className="select-none">
        <span className="system-xs-medium px-1">Enterprise</span>
      </PremiumBadge>
    )
  }
  return null
}

export default LicenseNav
