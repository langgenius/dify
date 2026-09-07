'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { MessageFastPlus } from '../../base/icons/src/vender/line/communication'
import UsageInfo from '../usage-info'
import { parseLimit } from '../utils'

type Props = Readonly<{
  className?: string
}>

const Usage: FC<Props> = ({ className }) => {
  const { t } = useTranslation()
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
  if (!features)
    return (
      <SkeletonRectangle
        aria-busy="true"
        className={cn('h-24 animate-pulse rounded-xl', className)}
      />
    )
  return (
    <UsageInfo
      className={className}
      Icon={MessageFastPlus}
      name={t(($) => $['annotatedResponse.quotaTitle'], { ns: 'billing' })}
      usage={features.annotation_quota_limit.size}
      total={parseLimit(features.annotation_quota_limit.limit)}
    />
  )
}
export default React.memo(Usage)
