'use client'
import type { FC } from 'react'
import {
  RiApps2Line,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import UsageInfo from '../usage-info'

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
      Icon={RiApps2Line}
      name={t('usagePage.buildApps', { ns: 'billing' })}
      usage={usage.buildApps}
      total={total.buildApps}
    />
  )
}
export default React.memo(AppsInfo)
