'use client'

import { useQueryState } from 'nuqs'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import dynamic from '@/next/dynamic'
import { useEducationExpireNotice } from './use-expire-notice'

const ExpireNoticeModal = dynamic(() => import('./modal'), { ssr: false })

export function EducationExpireNotice() {
  const [pricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const [notice, dismissNotice] = useEducationExpireNotice()

  if (!notice || pricing === 'open') return null

  return (
    <ExpireNoticeModal
      expireAt={notice.expireAt}
      expired={notice.expired}
      onClose={dismissNotice}
    />
  )
}
