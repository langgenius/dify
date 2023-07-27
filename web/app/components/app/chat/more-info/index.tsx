'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageMore } from '../type'
import { formatNumber } from '@/utils/format'

export type IMoreInfoProps = { more: MessageMore; isQuestion: boolean }

const MoreInfo: FC<IMoreInfoProps> = ({ more, isQuestion }) => {
  const { t } = useTranslation()
  return (<div className={`mt-1 space-x-2 text-xs text-gray-400 ${isQuestion ? 'mr-2 text-right ' : 'ml-2 text-left float-right'}`}>
    <span>{`${t('appLog.detail.timeConsuming')} ${more.latency}${t('appLog.detail.second')}`}</span>
    <span>{`${t('appLog.detail.tokenCost')} ${formatNumber(more.tokens)}`}</span>
    <span>· </span>
    <span>{more.time} </span>
  </div>)
}
export default React.memo(MoreInfo)
