'use client'
import type { FC } from 'react'
import type { BasicPlan } from '../type'
import {
  RiHardDrive3Line,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '../type'
import UsageInfo from '../usage-info'
import { getPlanVectorSpaceLimitMB } from '../utils'

type Props = {
  className?: string
}

// Storage threshold in MB - usage below this shows as "< 50 MB"
const STORAGE_THRESHOLD_MB = getPlanVectorSpaceLimitMB(Plan.sandbox)

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

  // Determine total based on plan type (in MB), derived from ALL_PLANS config
  const getTotalInMB = () => {
    const planLimit = getPlanVectorSpaceLimitMB(type as BasicPlan)
    // For known plans, use the config value; otherwise fall back to API response
    return planLimit > 0 ? planLimit : total.vectorSpace
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
      isSandboxPlan={isSandbox}
    />
  )
}
export default React.memo(VectorSpaceInfo)
