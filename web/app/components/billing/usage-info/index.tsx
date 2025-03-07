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
  unit = '',
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
  return (
    <div className={cn('p-4 flex flex-col gap-2 rounded-xl bg-components-panel-bg', className)}>
      <Icon className='w-4 h-4 text-text-tertiary' />
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
      <div className='flex items-center gap-1 system-md-semibold  text-text-primary'>
        {usage}
        <div className='system-md-regular text-text-quaternary'>/</div>
        <div>{total === NUM_INFINITE ? t('billing.plansCommon.unlimited') : `${total}${unit}`}</div>
      </div>
      <ProgressBar
        percent={percent}
        color={color}
      />
    </div>
  )
}
export default React.memo(UsageInfo)
