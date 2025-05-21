'use client'

import { LicenseStatus } from '@/types/feature'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import PremiumBadge from '../../base/premium-badge'
import { RiHourglass2Fill } from '@remixicon/react'
import { useGlobalPublicStore } from '@/context/global-public-context'

const LicenseNav = () => {
  const { t } = useTranslation()
  const { systemFeatures } = useGlobalPublicStore()

  if (systemFeatures.license?.status === LicenseStatus.EXPIRING) {
    const expiredAt = systemFeatures.license?.expired_at
    const count = dayjs(expiredAt).diff(dayjs(), 'days')
    return <PremiumBadge color='orange' className='select-none'>
      <RiHourglass2Fill className='flex size-3 items-center pl-0.5 text-components-premium-badge-indigo-text-stop-0' />
      {count <= 1 && <span className='system-xs-medium px-0.5'>{t('common.license.expiring', { count })}</span>}
      {count > 1 && <span className='system-xs-medium px-0.5'>{t('common.license.expiring_plural', { count })}</span>}
    </PremiumBadge>
  }
  if (systemFeatures.license.status === LicenseStatus.ACTIVE) {
    return <PremiumBadge color="indigo" className='select-none'>
      <span className='system-xs-medium px-1'>Enterprise</span>
    </PremiumBadge>
  }
  return null
}

export default LicenseNav
