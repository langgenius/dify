'use client'
import type { FC } from 'react'
import { RiHardDrive3Line } from '@remixicon/react'
import { useSuspenseQueries } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const [{ data: plan }, { data: vectorSpace }] = useSuspenseQueries({
    queries: [
      consoleQuery.features.get.queryOptions({
        select: (features) => features.billing.subscription.plan,
      }),
      consoleQuery.features.vectorSpace.get.queryOptions(),
    ],
  })

  return (
    <UsageInfo
      className={className}
      Icon={RiHardDrive3Line}
      name={t(($) => $['usagePage.vectorSpace'], { ns: 'billing' })}
      tooltip={t(($) => $['usagePage.vectorSpaceTooltip'], { ns: 'billing' }) as string}
      usage={vectorSpace.size}
      total={vectorSpace.limit}
      unit="MB"
      unitPosition="inline"
      storageMode
      storageThreshold={STORAGE_THRESHOLD_MB}
      storageTooltip={t(($) => $['usagePage.storageThresholdTooltip'], { ns: 'billing' }) as string}
      isSandboxPlan={plan === 'sandbox'}
      usageUnknown={vectorSpace.usage_unknown}
    />
  )
}
export default React.memo(VectorSpaceInfo)
