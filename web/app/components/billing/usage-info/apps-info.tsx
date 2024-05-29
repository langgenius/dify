'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ChatBot } from '../../base/icons/src/vender/line/communication'
import UsageInfo from '../usage-info'
import { useProviderContext } from '@/context/provider-context'

type Props = {
  className?: string
}

const AppsInfo: FC<Props> = ({
  className,
}) => {
  const { t } = useTranslation()
  const { plan } = useProviderContext()
  const {
    usage,
    total,
  } = plan
  return (
    <UsageInfo
      className={className}
      Icon={ChatBot}
      name={t('billing.plansCommon.buildApps')}
      usage={usage.buildApps}
      total={total.buildApps}
    />
  )
}
export default React.memo(AppsInfo)
