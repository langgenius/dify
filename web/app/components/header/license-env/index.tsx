'use client'

import AppContext from '@/context/app-context'
import { LicenseStatus } from '@/types/feature'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import dayjs from 'dayjs'

const LicenseNav = () => {
  const { t } = useTranslation()
  const systemFeatures = useContextSelector(AppContext, s => s.systemFeatures)

  if (systemFeatures.license?.status === LicenseStatus.EXPIRING) {
    const expiredAt = systemFeatures.license?.expired_at
    const count = dayjs(expiredAt).diff(dayjs(), 'days')
    return <div className='bg-util-colors-orange-orange-50 border-util-colors-orange-orange-100 system-xs-medium text-util-colors-orange-orange-600 mr-4 rounded-full px-2 py-1'>
      {count <= 1 && <span>{t('common.license.expiring', { count })}</span>}
      {count > 1 && <span>{t('common.license.expiring_plural', { count })}</span>}
    </div>
  }
  if (systemFeatures.license.status === LicenseStatus.ACTIVE) {
    return <div className='bg-util-colors-indigo-indigo-50 border-util-colors-indigo-indigo-100 system-xs-medium text-util-colors-indigo-indigo-600 mr-4 rounded-md px-2 py-1'>
      Enterprise
    </div>
  }
  return null
}

export default LicenseNav
