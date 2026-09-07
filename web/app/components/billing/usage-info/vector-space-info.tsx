'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiHardDrive3Line } from '@remixicon/react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
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
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
  const { data: vectorSpace } = useQuery(consoleQuery.features.vectorSpace.get.queryOptions())
  if (!features || !vectorSpace)
    return (
      <SkeletonRectangle
        aria-busy="true"
        className={cn('h-24 animate-pulse rounded-xl', className)}
      />
    )

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
      isSandboxPlan={features.billing.subscription.plan === 'sandbox'}
      usageUnknown={vectorSpace.usage_unknown}
    />
  )
}
export default React.memo(VectorSpaceInfo)
