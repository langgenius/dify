'use client'
import type { FC } from 'react'
import {
  RiHardDrive3Line,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '../type'
import UsageInfo from '../usage-info'

type Props = {
  className?: string
}

// Storage threshold in MB - usage below this shows as "< 50 MB"
const STORAGE_THRESHOLD_MB = 50

const VectorSpaceInfo: FC<Props> = ({
  className,
}) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const {
    type,
    usage,
    total,
  } = plan

  // Determine total based on plan type (in MB)
  const getTotalInMB = () => {
    switch (type) {
      case Plan.sandbox:
        return STORAGE_THRESHOLD_MB // 50 MB
      case Plan.professional:
        return 5 * 1024 // 5 GB = 5120 MB
      case Plan.team:
        return 20 * 1024 // 20 GB = 20480 MB
      default:
        return total.vectorSpace
    }
  }

  const totalInMB = getTotalInMB()
  const isSandbox = type === Plan.sandbox

  return (
    <UsageInfo
      className={className}
      Icon={RiHardDrive3Line}
      name={t('usagePage.vectorSpace', { ns: 'billing' })}
      tooltip={t('usagePage.vectorSpaceTooltip', { ns: 'billing' }) as string}
      usage={usage.vectorSpace}
      total={totalInMB}
      unit="MB"
      unitPosition="inline"
      storageMode
      storageThreshold={STORAGE_THRESHOLD_MB}
      storageTooltip={t('usagePage.storageThresholdTooltip', { ns: 'billing' }) as string}
      storageTotalDisplay={`${totalInMB}MB`}
      isSandboxPlan={isSandbox}
    />
  )
}
export default React.memo(VectorSpaceInfo)
