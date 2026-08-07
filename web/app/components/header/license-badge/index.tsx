'use client'

import { zLicenseStatus } from '@dify/contracts/api/console/system-features/zod.gen'
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import PremiumBadge from '../../base/premium-badge'

function LicenseBadge() {
  const { t } = useTranslation()
  const { data: license } = useQuery(consoleQuery.systemFeatures.license.get.queryOptions())
  const isExpiring = license?.status === zLicenseStatus.enum.expiring

  if (isExpiring && license.license_expiry_notice_enabled) {
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
  if (license?.status === zLicenseStatus.enum.active || isExpiring) {
    return (
      <PremiumBadge color="indigo" className="select-none">
        <span className="px-1 system-xs-medium">Enterprise</span>
      </PremiumBadge>
    )
  }
  return null
}

export default LicenseBadge
