'use client'

import AppContext from '@/context/app-context'
import { LicenseStatus } from '@/types/feature'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import dayjs from 'dayjs'
import PremiumBadge from '../../base/premium-badge'
import { RiHourglass2Fill } from '@remixicon/react'

const LicenseNav = () => {
  const { t } = useTranslation()
  const systemFeatures = useContextSelector(AppContext, s => s.systemFeatures)

  if (systemFeatures.license?.status === LicenseStatus.EXPIRING) {
    const expiredAt = systemFeatures.license?.expired_at
    const count = dayjs(expiredAt).diff(dayjs(), 'days')
    return <PremiumBadge color='orange' className='select-none'>
      <RiHourglass2Fill className='flex items-center pl-0.5 size-3 text-components-premium-badge-indigo-text-stop-0' />
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
