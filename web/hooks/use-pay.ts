'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'
import { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import { fetchSparkFreeQuotaVerify } from '@/service/common'
import type { ConfirmCommonProps } from '@/app/components/base/confirm/common'

export type ConfirmType = Pick<ConfirmCommonProps, 'type' | 'title' | 'desc'>

export const useAnthropicCheckPay = () => {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const searchParams = useSearchParams()
  const providerName = searchParams.get('provider_name')
  const paymentResult = searchParams.get('payment_result')

  useEffect(() => {
    if (providerName === ProviderEnum.anthropic && (paymentResult === 'succeeded' || paymentResult === 'cancelled')) {
      setConfirm({
        type: paymentResult === 'succeeded' ? 'success' : 'danger',
        title: paymentResult === 'succeeded' ? t('common.actionMsg.paySucceeded') : t('common.actionMsg.payCancelled'),
      })
    }
  }, [providerName, paymentResult, t])

  return confirm
}

const QUOTA_RECEIVE_STATUS = {
  success: {
    'en': 'Anthropic',
    'zh-Hans': '领取成功，将在 5 分钟后自动增加配额',
  },
  fail: {
    'en': 'Anthropic',
    'zh-Hans': '领取失败',
  },
}

export const useSparkCheckQuota = () => {
  const { locale } = useContext(I18n)
  const [shouldVerify, setShouldVerify] = useState(false)
  const { data } = useSWR(
    shouldVerify
      ? `/workspaces/current/model-providers/${ProviderEnum.spark}/free-quota-qualification-verify`
      : null,
    fetchSparkFreeQuotaVerify,
  )
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const provider = searchParams.get('provider')
  const result = searchParams.get('result')

  useEffect(() => {
    if (type === 'provider_apply_callback' && provider === ProviderEnum.spark && result === 'success')
      setShouldVerify(true)
  }, [type, provider, result])

  return data
    ? {
      type: data.flag ? 'success' : 'danger',
      title: data.flag ? QUOTA_RECEIVE_STATUS.success[locale] : QUOTA_RECEIVE_STATUS.fail[locale],
      desc: !data.flag ? data.reason : undefined,
    }
    : null
}
