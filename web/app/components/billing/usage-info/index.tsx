'use client'
import type { FC } from 'react'
import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ProgressBar from '../progress-bar'
import { NUM_INFINITE } from '../config'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'
import { fetchQuotaUsage } from '../service' // Assuming service.ts is in the same directory
import type { QuotaUsageResponse, QuotaLimits, CurrentUsage } from '../type'
import {
  UsersIcon,
  DocumentTextIcon,
  CubeIcon,
  ServerStackIcon,
  CpuChipIcon,
  CloudArrowUpIcon,
} from '@heroicons/react/24/outline'
import Alert from '@/app/components/base/alert'

// Renamed original UsageInfo to UsageItem
type UsageItemProps = {
  className?: string
  Icon: React.ElementType
  name: string
  tooltip?: string
  usage: number | string // Usage can be a string like "N/A"
  total: number | null // Limit can be null for unlimited
  unit?: string
}

const LOW_USAGE_PERCENT = 50
const MEDIUM_USAGE_PERCENT = 80

const UsageItem: FC<UsageItemProps> = ({
  className,
  Icon,
  name,
  tooltip,
  usage,
  total,
  unit = '',
}) => {
  const { t } = useTranslation()

  const isUnlimited = total === null || total === 0 || total === NUM_INFINITE
  const numericUsage = typeof usage === 'number' ? usage : 0
  const numericTotal = typeof total === 'number' ? total : 0

  let percent = 0
  if (!isUnlimited && numericTotal > 0 && typeof usage === 'number')
    percent = (numericUsage / numericTotal) * 100
  else if (isUnlimited && typeof usage === 'number' && usage > 0)
    percent = 0 // Show some minimal bar for used unlimited resources, or handle as 0
  
  // If usage is "N/A" or similar, treat percent as 0 or handle as special case
  if (typeof usage !== 'number')
    percent = 0

  const color = (() => {
    if (isUnlimited || percent < LOW_USAGE_PERCENT)
      return 'bg-components-progress-bar-progress-solid'
    if (percent < MEDIUM_USAGE_PERCENT)
      return 'bg-components-progress-warning-progress'
    return 'bg-components-progress-error-progress'
  })()

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl bg-components-panel-bg p-4', className)}>
      <Icon className='h-4 w-4 text-text-tertiary' />
      <div className='flex items-center gap-1'>
        <div className='system-xs-medium text-text-tertiary'>{name}</div>
        {tooltip && (
          <Tooltip
            popupContent={<div className='w-[180px]'>{tooltip}</div>}
          />
        )}
      </div>
      <div className='system-md-semibold flex items-center gap-1 text-text-primary'>
        {typeof usage === 'number' ? usage : t('billing.plansCommon.notAvailable')}
        <div className='system-md-regular text-text-quaternary'>/</div>
        <div>{isUnlimited ? t('billing.plansCommon.unlimited') : `${numericTotal}${unit}`}</div>
      </div>
      <ProgressBar
        percent={percent}
        color={color}
      />
    </div>
  )
}

// New UsageInfo container component
const UsageInfoContainer: FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslation()
  const [quotaUsage, setQuotaUsage] = useState<QuotaUsageResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<any>(null)

  const loadQuotaUsage = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchQuotaUsage()
      setQuotaUsage(data)
    }
    catch (e) {
      setError(e)
      console.error('Failed to fetch quota usage:', e)
    }
    finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadQuotaUsage()
  }, [loadQuotaUsage])

  // Resource key to display name and icon mapping
  const resourceDisplayConfig: Record<keyof CurrentUsage, { name: string; Icon: React.ElementType; unit?: string; tooltip?: string }> = {
    max_users: { name: t('billing.usageInfo.teamMembers'), Icon: UsersIcon },
    max_documents: { name: t('billing.usageInfo.documents'), Icon: DocumentTextIcon },
    max_apps: { name: t('billing.usageInfo.apps'), Icon: CubeIcon },
    max_datasets: { name: t('billing.usageInfo.datasets'), Icon: ServerStackIcon },
    max_document_size_mb: { name: t('billing.usageInfo.documentProcessing'), Icon: CloudArrowUpIcon, unit: 'MB' }, // Assuming this is a limit per upload
    max_api_calls_per_day: { name: t('billing.usageInfo.apiCallsPerDay'), Icon: CpuChipIcon },
    max_api_calls_per_month: { name: t('billing.usageInfo.apiCallsPerMonth'), Icon: CpuChipIcon },
  }

  if (isLoading) {
    return (
      <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4', className)}>
        {Array.from({ length: 4 }).map((_, i) => ( // Skeleton loaders
          <div key={i} className="flex flex-col gap-2 rounded-xl bg-components-panel-bg p-4 animate-pulse">
            <div className="h-4 w-4 bg-gray-200 rounded"></div>
            <div className="h-3 w-1/2 bg-gray-200 rounded mb-1"></div>
            <div className="h-4 w-1/3 bg-gray-200 rounded mb-2"></div>
            <div className="h-2 bg-gray-200 rounded"></div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Alert type="error" className={className}>
        {t('billing.usageInfo.fetchFailed')} {error.message || String(error)}
      </Alert>
    )
  }

  if (!quotaUsage)
    return null

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4', className)}>
      {(Object.keys(quotaUsage.usage) as Array<keyof CurrentUsage>).map((key) => {
        const config = resourceDisplayConfig[key]
        if (!config) // Skip if no display config for this key
          return null

        // Skip rendering items where usage is "N/A" and limit is also not set (or 0/null)
        // This primarily targets API call limits which are marked "N/A" in current backend summary for usage
        if (typeof quotaUsage.usage[key] !== 'number' && (!quotaUsage.limits[key] || quotaUsage.limits[key] === null)) {
            if (key === 'max_document_size_mb' && typeof quotaUsage.limits[key] === 'number' && quotaUsage.limits[key]! > 0) {
                 // Special case for max_document_size_mb: show if limit exists, even if usage is "N/A"
            } else {
                return null;
            }
        }


        return (
          <UsageItem
            key={key}
            Icon={config.Icon}
            name={config.name}
            tooltip={config.tooltip}
            usage={quotaUsage.usage[key]}
            total={quotaUsage.limits[key]}
            unit={config.unit}
          />
        )
      })}
    </div>
  )
}

export default React.memo(UsageInfoContainer)
