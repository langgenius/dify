'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { MessageFastPlus } from '../../base/icons/src/vender/line/communication'
import UsageInfo from '../usage-info'

type Props = {
  className?: string
}

const Usage: FC<Props> = ({
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
      Icon={MessageFastPlus}
      name={t('annotatedResponse.quotaTitle', { ns: 'billing' })}
      usage={usage.annotatedResponse}
      total={total.annotatedResponse}
    />
  )
}
export default React.memo(Usage)
