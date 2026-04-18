'use client'
import type { MeterTone } from '@langgenius/dify-ui/meter'
import type { ComponentType, FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { MeterIndicator, MeterRoot, MeterTrack } from '@langgenius/dify-ui/meter'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { NUM_INFINITE } from '../config'

type Props = {
  className?: string
  Icon: ComponentType<{ className?: string }>
  name: string
  tooltip?: string
  usage: number
  total: number
  unit?: string
  unitPosition?: 'inline' | 'suffix'
  resetHint?: string
  resetInDays?: number
  hideIcon?: boolean
  // Props for the 50MB threshold display logic
  storageMode?: boolean
  storageThreshold?: number
  storageTooltip?: string
  isSandboxPlan?: boolean
}

const UsageInfo: FC<Props> = ({
  className,
  Icon,
  name,
  tooltip,
  usage,
  total,
  unit,
  unitPosition = 'suffix',
  resetHint,
  resetInDays,
  hideIcon = false,
  storageMode = false,
  storageThreshold = 50,
  storageTooltip,
  isSandboxPlan = false,
}) => {
  const { t } = useTranslation()

  const isBelowThreshold = storageMode && usage < storageThreshold
  const isSandboxFull = storageMode && isSandboxPlan && usage >= storageThreshold

  // Single source of truth: sandbox full is visually clamped to 100%; all other
  // determinate cases show the real percent capped at 100. Tone derives from
  // this, so we never need a separate tone override.
  const rawPercent = total > 0 ? (usage / total) * 100 : 0
  const effectivePercent = isSandboxFull ? 100 : Math.min(rawPercent, 100)
  const tone: MeterTone
    = effectivePercent >= 100
      ? 'error'
      : effectivePercent >= 80
        ? 'warning'
        : 'neutral'

  const isUnlimited = total === NUM_INFINITE
  let totalDisplay: string | number = isUnlimited ? t('plansCommon.unlimited', { ns: 'billing' }) : total
  if (!isUnlimited && unit && unitPosition === 'inline')
    totalDisplay = `${total}${unit}`
  const showUnit = !!unit && !isUnlimited && unitPosition === 'suffix'
  const resetText = resetHint ?? (typeof resetInDays === 'number' ? t('usagePage.resetsIn', { ns: 'billing', count: resetInDays }) : undefined)

  const rightInfo: ReactNode = resetText
    ? (
        <div className="ml-auto flex-1 text-right system-xs-regular text-text-tertiary">
          {resetText}
        </div>
      )
    : showUnit
      ? (
          <div className="ml-auto system-xs-medium text-text-tertiary">
            {unit}
          </div>
        )
      : null

  const usageDisplay: ReactNode = (() => {
    if (storageMode) {
      if (isSandboxFull) {
        return (
          <div className="flex items-center gap-1">
            <span>{storageThreshold}</span>
            <span className="system-md-regular text-text-quaternary">/</span>
            <span>
              {storageThreshold}
              {' '}
              {unit}
            </span>
          </div>
        )
      }
      if (isBelowThreshold) {
        return (
          <div className="flex items-center gap-1">
            <span>
              &lt;
              {' '}
              {storageThreshold}
            </span>
            {!isSandboxPlan && (
              <>
                <span className="system-md-regular text-text-quaternary">/</span>
                <span>{totalDisplay}</span>
              </>
            )}
            {isSandboxPlan && <span>{unit}</span>}
          </div>
        )
      }
      return (
        <div className="flex items-center gap-1">
          <span>{usage}</span>
          <span className="system-md-regular text-text-quaternary">/</span>
          <span>{totalDisplay}</span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-1">
        <span>{usage}</span>
        <span className="system-md-regular text-text-quaternary">/</span>
        <span>{totalDisplay}</span>
      </div>
    )
  })()

  const bar: ReactNode = isBelowThreshold
    ? (
        // Decorative "< N MB" placeholder — not a meter, not a progressbar.
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-md bg-components-progress-bar-bg"
        >
          <div
            className={cn(
              'h-1 rounded-md bg-progress-bar-indeterminate-stripe',
              isSandboxPlan ? 'w-full' : 'w-[30px]',
            )}
          />
        </div>
      )
    : (
        <MeterRoot value={effectivePercent} max={100}>
          <MeterTrack>
            <MeterIndicator tone={tone} />
          </MeterTrack>
        </MeterRoot>
      )

  const wrapWithStorageTooltip = (children: ReactNode) => {
    if (storageMode && storageTooltip) {
      return (
        <Tooltip
          popupContent={<div className="w-[200px]">{storageTooltip}</div>}
          asChild={false}
        >
          <div className="cursor-default">{children}</div>
        </Tooltip>
      )
    }
    return children
  }

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl bg-components-panel-bg p-4', className)}>
      {!hideIcon && Icon && (
        <Icon className="h-4 w-4 text-text-tertiary" />
      )}
      <div className="flex items-center gap-1">
        <div className="system-xs-medium text-text-tertiary">{name}</div>
        {tooltip && (
          <Tooltip
            popupContent={(
              <div className="w-[180px]">
                {tooltip}
              </div>
            )}
          />
        )}
      </div>
      <div className="flex items-center gap-1 system-md-semibold text-text-primary">
        {wrapWithStorageTooltip(usageDisplay)}
        {rightInfo}
      </div>
      {wrapWithStorageTooltip(bar)}
    </div>
  )
}
export default React.memo(UsageInfo)
