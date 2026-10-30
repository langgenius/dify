'use client'
import type { FC } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getCountQuota } from '../quota'
import UsageInfo from '../usage-info'

type Props = Readonly<{
  className?: string
}>

const Usage: FC<Props> = ({ className }) => {
  const { t } = useTranslation(['billing'])
  const { data: annotationQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      select: (features) => features.annotation_quota_limit,
    }),
  )
  if (!annotationQuota) return null
  return (
    <UsageInfo
      className={className}
      iconClassName={'i-custom-vender-line-communication-message-fast-plus'}
      name={t(($) => $['annotatedResponse.quotaTitle'], { ns: 'billing' })}
      quota={getCountQuota(annotationQuota)}
    />
  )
}
export default React.memo(Usage)
