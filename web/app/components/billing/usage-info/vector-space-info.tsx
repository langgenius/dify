'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ArtificialBrain } from '../../base/icons/src/vender/line/development'
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
      Icon={ArtificialBrain}
      name={t('billing.plansCommon.vectorSpace')}
      tooltip={t('billing.plansCommon.vectorSpaceTooltip') as string}
      usage={usage.vectorSpace}
      total={total.vectorSpace}
      unit='MB'
    />
  )
}
export default React.memo(VectorSpaceInfo)
