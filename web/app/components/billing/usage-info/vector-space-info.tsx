'use client'
import type { FC } from 'react'
import { RiHardDrive3Line } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import UsageInfo from '../usage-info'
import { getPlanVectorSpaceLimitMB } from '../utils'

type Props = Readonly<{
  className?: string
}>

// Storage threshold in MB - usage below this shows as "< 50 MB"
const STORAGE_THRESHOLD_MB = getPlanVectorSpaceLimitMB('sandbox')

const VectorSpaceInfo: FC<Props> = ({ className }) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const { data: vectorSpace } = useQuery(consoleQuery.features.vectorSpace.get.queryOptions())
  const vectorSpaceUsage = vectorSpace?.size ?? plan.usage.vectorSpace
  const vectorSpaceLimit = vectorSpace?.limit ?? getPlanVectorSpaceLimitMB(plan.type)
  const isSandbox = plan.type === 'sandbox'

  return (
    <UsageInfo
      className={className}
      Icon={RiHardDrive3Line}
      name={t(($) => $['usagePage.vectorSpace'], { ns: 'billing' })}
      tooltip={t(($) => $['usagePage.vectorSpaceTooltip'], { ns: 'billing' }) as string}
      usage={vectorSpaceUsage}
      total={vectorSpaceLimit}
      unit="MB"
      unitPosition="inline"
      storageMode
      storageThreshold={STORAGE_THRESHOLD_MB}
      storageTooltip={t(($) => $['usagePage.storageThresholdTooltip'], { ns: 'billing' }) as string}
      isSandboxPlan={isSandbox}
      usageUnknown={vectorSpace?.usage_unknown}
    />
  )
}
export default React.memo(VectorSpaceInfo)
