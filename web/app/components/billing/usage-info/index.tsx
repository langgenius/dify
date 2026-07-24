'use client'
import type { ComponentType, FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'
import { NUM_INFINITE } from '../config'
import ProgressBar from '../progress-bar'

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

const WARNING_THRESHOLD = 80

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

  // Special display logic for usage below threshold (only in storage mode)
  const isBelowThreshold = storageMode && usage < storageThreshold
  // Sandbox at full capacity (usage >= threshold and it's sandbox plan)
  const isSandboxFull = storageMode && isSandboxPlan && usage >= storageThreshold

  const percent = usage / total * 100
  const getProgressColor = () => {
    if (percent >= 100)
      return 'bg-components-progress-error-progress'
    if (percent >= WARNING_THRESHOLD)
      return 'bg-components-progress-warning-progress'
    return 'bg-components-progress-bar-progress-solid'
  }
  const color = getProgressColor()
  const isUnlimited = total === NUM_INFINITE
  let totalDisplay: string | number = isUnlimited ? t('plansCommon.unlimited', { ns: 'billing' }) : total
  if (!isUnlimited && unit && unitPosition === 'inline')
    totalDisplay = `${total}${unit}`
  const showUnit = !!unit && !isUnlimited && unitPosition === 'suffix'
  const resetText = resetHint ?? (typeof resetInDays === 'number' ? t('usagePage.resetsIn', { ns: 'billing', count: resetInDays }) : undefined)

  const renderRightInfo = () => {
    if (resetText) {
      return (
        <div className="system-xs-regular ml-auto flex-1 text-right text-text-tertiary">
          {resetText}
        </div>
      )
    }
    if (showUnit) {
      return (
        <div className="system-xs-medium ml-auto text-text-tertiary">
          {unit}
        </div>
      )
    }
    return null
  }

  // Render usage display
  const renderUsageDisplay = () => {
    // Storage mode: special display logic
    if (storageMode) {
      // Sandbox user at full capacity
      if (isSandboxFull) {
        return (
          <div className="flex items-center gap-1">
            <span>
              {storageThreshold}
            </span>
            <span className="system-md-regular text-text-quaternary">/</span>
            <span>
              {storageThreshold}
              {' '}
              {unit}
            </span>
          </div>
        )
      }
      // Usage below threshold - show "< 50 MB" or "< 50 / 5GB"
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
      // Pro/Team users with usage >= threshold - show actual usage
      return (
        <div className="flex items-center gap-1">
          <span>{usage}</span>
          <span className="system-md-regular text-text-quaternary">/</span>
          <span>{totalDisplay}</span>
        </div>
      )
    }

    // Default display (storageMode = false)
    return (
      <div className="flex items-center gap-1">
        <span>{usage}</span>
        <span className="system-md-regular text-text-quaternary">/</span>
        <span>{totalDisplay}</span>
      </div>
    )
  }

  const renderWithTooltip = (children: React.ReactNode) => {
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

  // Render progress bar with optional tooltip wrapper
  const renderProgressBar = () => {
    const progressBar = (
      <ProgressBar
        percent={isBelowThreshold ? 0 : percent}
        color={isSandboxFull ? 'bg-components-progress-error-progress' : color}
        indeterminate={isBelowThreshold}
        indeterminateFull={isBelowThreshold && isSandboxPlan}
      />
    )
    return renderWithTooltip(progressBar)
  }

  const renderUsageWithTooltip = () => {
    return renderWithTooltip(renderUsageDisplay())
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
      <div className="system-md-semibold flex items-center gap-1 text-text-primary">
        {renderUsageWithTooltip()}
        {renderRightInfo()}
      </div>
      {renderProgressBar()}
    </div>
  )
}
export default React.memo(UsageInfo)
