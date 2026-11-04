'use client'
import type { FC } from 'react'
import { useSuspenseQueries } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getVectorSpaceQuota } from '../quota'
import UsageInfo from '../usage-info'

type Props = Readonly<{
  className?: string
}>

const VectorSpaceInfo: FC<Props> = ({ className }) => {
  const { t } = useTranslation(['billing'])
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
      iconClassName="i-ri-hard-drive-3-line"
      name={t(($) => $['usagePage.vectorSpace'], { ns: 'billing' })}
      tooltip={t(($) => $['usagePage.vectorSpaceTooltip'], { ns: 'billing' }) as string}
      quota={getVectorSpaceQuota(vectorSpace)}
      unit="MB"
      unitPosition="inline"
      storageMode
      storageThreshold={50}
      storageTooltip={t(($) => $['usagePage.storageThresholdTooltip'], { ns: 'billing' }) as string}
      isSandboxPlan={plan === 'sandbox'}
      usageUnknown={vectorSpace.usage_unknown}
    />
  )
}
export default React.memo(VectorSpaceInfo)
