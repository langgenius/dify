'use client'

import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { LicenseStatus } from '@/features/system-features/constants'
import { consoleQuery } from '@/service/client'
import PremiumBadge from '../../base/premium-badge'

function LicenseNav() {
  const { t } = useTranslation()
  const { data: license } = useQuery(consoleQuery.systemFeatures.license.get.queryOptions())

  if (license?.status === LicenseStatus.EXPIRING) {
    const count = dayjs(license.expired_at).diff(dayjs(), 'days')
    return (
      <PremiumBadge color="orange" className="select-none">
        <span
          className={
            'i-ri-hourglass-2-fill flex size-3 items-center pl-0.5 text-components-premium-badge-indigo-text-stop-0'
          }
          aria-hidden="true"
        />
        {count <= 1 && (
          <span className="px-0.5 system-xs-medium">
            {t(($) => $['license.expiring'], { ns: 'common', count })}
          </span>
        )}
        {count > 1 && (
          <span className="px-0.5 system-xs-medium">
            {t(($) => $['license.expiring_plural'], { ns: 'common', count })}
          </span>
        )}
      </PremiumBadge>
    )
  }
  if (license?.status === LicenseStatus.ACTIVE) {
    return (
      <PremiumBadge color="indigo" className="select-none">
        <span className="px-1 system-xs-medium">Enterprise</span>
      </PremiumBadge>
    )
  }
  return null
}

export default LicenseNav
