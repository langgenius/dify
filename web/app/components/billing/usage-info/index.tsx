'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import ProgressBar from '../progress-bar'
import { NUM_INFINITE } from '../config'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  Icon: any
  name: string
  tooltip?: string
  usage: number
  total: number
  unit?: string
  unitPosition?: 'inline' | 'suffix'
}

const LOW = 50
const MIDDLE = 80

const UsageInfo: FC<Props> = ({
  className,
  Icon,
  name,
  tooltip,
  usage,
  total,
  unit,
  unitPosition = 'suffix',
}) => {
  const { t } = useTranslation()

  const percent = usage / total * 100
  const color = (() => {
    if (percent < LOW)
      return 'bg-components-progress-bar-progress-solid'

    if (percent < MIDDLE)
      return 'bg-components-progress-warning-progress'

    return 'bg-components-progress-error-progress'
  })()
  const isUnlimited = total === NUM_INFINITE
  let totalDisplay: string | number = isUnlimited ? t('billing.plansCommon.unlimited') : total
  if (!isUnlimited && unit && unitPosition === 'inline')
    totalDisplay = `${total}${unit}`
  const showUnit = !!unit && !isUnlimited && unitPosition === 'suffix'

  return (
    <div className={cn('flex flex-col gap-2 rounded-xl bg-components-panel-bg p-4', className)}>
      <Icon className='h-4 w-4 text-text-tertiary' />
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
        {showUnit && (
          <div className='system-xs-medium ml-auto text-text-tertiary'>
            {unit}
          </div>
        )}
      </div>
      <ProgressBar
        percent={percent}
        color={color}
      />
    </div>
  )
}
export default React.memo(UsageInfo)
