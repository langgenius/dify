'use client'
import type { FC } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import UsageInfo from '../usage-info'
import { parseLimit } from '../utils'

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
      usage={annotationQuota.size}
      total={parseLimit(annotationQuota.limit)}
    />
  )
}
export default React.memo(Usage)
