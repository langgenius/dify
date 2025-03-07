'use client'
import type { FC } from 'react'
import React from 'react'
import {
  RiHardDrive3Line,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import UsageInfo from '../usage-info'
import { useProviderContext } from '@/context/provider-context'

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
      name={t('billing.usagePage.vectorSpace')}
      tooltip={t('billing.usagePage.vectorSpaceTooltip') as string}
      usage={usage.vectorSpace}
      total={total.vectorSpace}
      unit='MB'
    />
  )
}
export default React.memo(VectorSpaceInfo)
