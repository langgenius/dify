'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageMore } from '../type'
import { formatNumber } from '@/utils/format'

export type IMoreInfoProps = {
  more: MessageMore
  isQuestion: boolean
  className?: string
}

const MoreInfo: FC<IMoreInfoProps> = ({ more, isQuestion, className }) => {
  const { t } = useTranslation()
  return (<div className={`mt-1 w-full text-xs text-gray-400 ${isQuestion ? 'mr-2 text-right ' : 'pl-2 text-left float-right'} ${className}`}>
    <span className='mr-2'>{`${t('appLog.detail.timeConsuming')} ${more.latency}${t('appLog.detail.second')}`}</span>
    <span className='mr-2'>{`${t('appLog.detail.tokenCost')} ${formatNumber(more.tokens)}`}</span>
    <span className='mr-2'>·</span>
    <span>{more.time}</span>
  </div>)
}
export default React.memo(MoreInfo)
