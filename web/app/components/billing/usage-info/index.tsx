'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import ProgressBar from '../progress-bar'
import { NUM_INFINITE } from '../config'
import Tooltip from '@/app/components/base/tooltip'
import { cn } from '@/utils/classnames'

type Props = {
  className?: string
  Icon: any
  name: string
  tooltip?: string
  usage: number
  total: number
  unit?: string
  unitPosition?: 'inline' | 'suffix'
  resetHint?: string
  resetInDays?: number
  hideIcon?: boolean
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
}) => {
  const { t } = useTranslation()

  const percent = usage / total * 100
  const color = percent >= 100
    ? 'bg-components-progress-error-progress'
    : (percent >= WARNING_THRESHOLD ? 'bg-components-progress-warning-progress' : 'bg-components-progress-bar-progress-solid')
  const isUnlimited = total === NUM_INFINITE
  let totalDisplay: string | number = isUnlimited ? t('billing.plansCommon.unlimited') : total
  if (!isUnlimited && unit && unitPosition === 'inline')
    totalDisplay = `${total}${unit}`
  const showUnit = !!unit && !isUnlimited && unitPosition === 'suffix'
  const resetText = resetHint ?? (typeof resetInDays === 'number' ? t('billing.usagePage.resetsIn', { count: resetInDays }) : undefined)
  const rightInfo = resetText
    ? (
      <div className='system-xs-regular ml-auto flex-1 text-right text-text-tertiary'>
        {resetText}
      </div>
    )
    : (showUnit && (
      <div className='system-xs-medium ml-auto text-text-tertiary'>
        {unit}
      </div>
    ))

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl bg-components-panel-bg p-4', className)}>
      {!hideIcon && Icon && (
        <Icon className='h-4 w-4 text-text-tertiary' />
      )}
      <div className='flex items-center gap-1'>
        <div className='system-xs-medium text-text-tertiary'>{name}</div>
        {tooltip && (
          <Tooltip
            popupContent={
              <div className='w-[180px]'>
                {tooltip}
              </div>
            }
          />
        )}
      </div>
      <div className='system-md-semibold flex items-center gap-1 text-text-primary'>
        <div className='flex items-center gap-1'>
          {usage}
          <div className='system-md-regular text-text-quaternary'>/</div>
          <div>{totalDisplay}</div>
        </div>
        {rightInfo}
      </div>
      <ProgressBar
        percent={percent}
        color={color}
      />
    </div>
  )
}
export default React.memo(UsageInfo)
