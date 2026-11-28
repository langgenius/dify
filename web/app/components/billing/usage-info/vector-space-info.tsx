'use client'
import type { VectorSpaceLimitationModel } from '@dify/contracts/api/console/features/types.gen'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { getVectorSpaceQuota } from '../quota'
import UsageInfo from '../usage-info'

type Props = Readonly<{
  className?: string
  isSandboxPlan: boolean
  vectorSpace: VectorSpaceLimitationModel | undefined
}>

const VectorSpaceInfo: FC<Props> = ({ className, isSandboxPlan, vectorSpace }) => {
  const { t } = useTranslation(['billing'])
  const name = t(($) => $['usagePage.vectorSpace'], { ns: 'billing' })

  if (!vectorSpace) {
    return (
      <div
        role="group"
        aria-label={name}
        className={cn('flex flex-col gap-2 rounded-xl bg-components-panel-bg p-4', className)}
      >
        <span aria-hidden className="i-ri-hard-drive-3-line size-4 text-text-tertiary" />
        <div className="system-xs-medium text-text-tertiary">{name}</div>
        <div className="system-xs-regular text-text-secondary">
          {t(($) => $['errors.unavailable'], { ns: 'billing' })}
        </div>
      </div>
    )
  }

  return (
    <UsageInfo
      className={className}
      iconClassName="i-ri-hard-drive-3-line"
      name={name}
      tooltip={t(($) => $['usagePage.vectorSpaceTooltip'], { ns: 'billing' }) as string}
      quota={getVectorSpaceQuota(vectorSpace)}
      unit="MB"
      unitPosition="inline"
      storageMode
      storageThreshold={50}
      storageTooltip={t(($) => $['usagePage.storageThresholdTooltip'], { ns: 'billing' }) as string}
      isSandboxPlan={isSandboxPlan}
      usageUnknown={vectorSpace.usage_unknown}
    />
  )
}
export default React.memo(VectorSpaceInfo)
