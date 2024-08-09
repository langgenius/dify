'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import ProgressBar from '../progress-bar'
import { NUM_INFINITE } from '../config'
import Tooltip from '@/app/components/base/tooltip'

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
      return '#155EEF'

    if (percent < MIDDLE)
      return '#F79009'

    return '#F04438'
  })()
  return (
    <div className={className}>
      <div className='flex justify-between h-5 items-center'>
        <div className='flex items-center'>
          <Icon className='w-4 h-4 text-gray-700' />
          <div className='mx-1 leading-5 text-sm font-medium text-gray-700'>{name}</div>
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
        <div className='flex items-center leading-[18px] text-[13px] font-normal'>
          <div style={{
            color: percent < LOW ? '#344054' : color,
          }}>{usage}{unit}</div>
          <div className='mx-1 text-gray-300'>/</div>
          <div className='text-gray-500'>{total === NUM_INFINITE ? t('billing.plansCommon.unlimited') : `${total}${unit}`}</div>
        </div>
      </div>
      <div className='mt-2'>
        <ProgressBar
          percent={percent}
          color={color}
        />
      </div>
    </div>
  )
}
export default React.memo(UsageInfo)
