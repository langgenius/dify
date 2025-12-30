'use client'
import type { FC } from 'react'
import {
  RiHardDrive3Line,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import UsageInfo from '../usage-info'

type Props = {
  className?: string
}

const VectorSpaceInfo: FC<Props> = ({
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
      Icon={RiHardDrive3Line}
      name={t('usagePage.vectorSpace', { ns: 'billing' })}
      tooltip={t('usagePage.vectorSpaceTooltip', { ns: 'billing' }) as string}
      usage={usage.vectorSpace}
      total={total.vectorSpace}
      unit="MB"
      unitPosition="inline"
    />
  )
}
export default React.memo(VectorSpaceInfo)
