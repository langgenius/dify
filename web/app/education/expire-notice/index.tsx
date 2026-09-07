'use client'

import { usePricingModal } from '@/hooks/use-query-params'
import dynamic from '@/next/dynamic'
import { useEducationExpireNotice } from './use-expire-notice'

const ExpireNoticeModal = dynamic(() => import('./modal'), { ssr: false })

export function EducationExpireNotice() {
  const [isPricingModalOpen] = usePricingModal()
  const [notice, dismissNotice] = useEducationExpireNotice()

  if (!notice || isPricingModalOpen) return null

  return (
    <ExpireNoticeModal
      expireAt={notice.expireAt}
      expired={notice.expired}
      onClose={dismissNotice}
    />
  )
}
