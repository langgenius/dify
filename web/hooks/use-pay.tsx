'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useContext } from 'use-context-selector'
import I18n from '@/context/i18n'
import {
  fetchDataSourceNotionBinding,
  fetchFreeQuotaVerify,
} from '@/service/common'
import type { ConfirmCommonProps } from '@/app/components/base/confirm/common'
import Confirm from '@/app/components/base/confirm/common'

export type ConfirmType = Pick<ConfirmCommonProps, 'type' | 'title' | 'desc'>

export const useAnthropicCheckPay = () => {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const searchParams = useSearchParams()
  const providerName = searchParams.get('provider_name')
  const paymentResult = searchParams.get('payment_result')

  useEffect(() => {
    if (providerName === 'anthropic' && (paymentResult === 'succeeded' || paymentResult === 'cancelled')) {
      setConfirm({
        type: paymentResult === 'succeeded' ? 'success' : 'danger',
        title: paymentResult === 'succeeded' ? t('common.actionMsg.paySucceeded') : t('common.actionMsg.payCancelled'),
      })
    }
  }, [providerName, paymentResult, t])

  return confirm
}

export const useBillingPay = () => {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const searchParams = useSearchParams()
  const paymentType = searchParams.get('payment_type')
  const paymentResult = searchParams.get('payment_result')

  useEffect(() => {
    if (paymentType === 'billing' && (paymentResult === 'succeeded' || paymentResult === 'cancelled')) {
      setConfirm({
        type: paymentResult === 'succeeded' ? 'success' : 'danger',
        title: paymentResult === 'succeeded' ? t('common.actionMsg.paySucceeded') : t('common.actionMsg.payCancelled'),
      })
    }
  }, [paymentType, paymentResult, t])

  return confirm
}

const QUOTA_RECEIVE_STATUS: Record<string, any> = {
  spark: {
    success: {
      'en': 'Successful collection, the quota will be automatically increased after 5 minutes.',
      'zh-Hans': '领取成功，将在 5 分钟后自动增加配额',
    },
    fail: {
      'en': 'Failure to collect',
      'zh-Hans': '领取失败',
    },
  },
  zhipuai: {
    success: {
      'en': 'Successful collection',
      'zh-Hans': '领取成功',
    },
    fail: {
      'en': 'Failure to collect',
      'zh-Hans': '领取失败',
    },
  },
}

const FREE_CHECK_PROVIDER = ['spark', 'zhipuai']
export const useCheckFreeQuota = () => {
  const { locale } = useContext(I18n)
  const router = useRouter()
  const [shouldVerify, setShouldVerify] = useState(false)
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const provider = searchParams.get('provider')
  const result = searchParams.get('result')
  const token = searchParams.get('token')

  const { data, error } = useSWR(
    shouldVerify
      ? `/workspaces/current/model-providers/${provider}/free-quota-qualification-verify?token=${token}`
      : null,
    fetchFreeQuotaVerify,
  )

  useEffect(() => {
    if (error)
      router.replace('/', { forceOptimisticNavigation: false })
  }, [error, router])

  useEffect(() => {
    if (type === 'provider_apply_callback' && FREE_CHECK_PROVIDER.includes(provider as string) && result === 'success')
      setShouldVerify(true)
  }, [type, provider, result])

  return (data && provider)
    ? {
      type: data.flag ? 'success' : 'danger',
      title: data.flag ? QUOTA_RECEIVE_STATUS[provider as string].success[locale] : QUOTA_RECEIVE_STATUS[provider].fail[locale],
      desc: !data.flag ? data.reason : undefined,
    }
    : null
}

export const useCheckNotion = () => {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const [canBinding, setCanBinding] = useState(false)
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const notionCode = searchParams.get('code')
  const notionError = searchParams.get('error')
  const { data } = useSWR(
    (canBinding && notionCode)
      ? `/oauth/data-source/binding/notion?code=${notionCode}`
      : null,
    fetchDataSourceNotionBinding,
  )

  useEffect(() => {
    if (data)
      router.replace('/', { forceOptimisticNavigation: false })
  }, [data, router])
  useEffect(() => {
    if (type === 'notion') {
      if (notionError) {
        setConfirm({
          type: 'danger',
          title: notionError,
        })
      }
      else if (notionCode) {
        setCanBinding(true)
      }
    }
  }, [type, notionCode, notionError])

  return confirm
}

export const CheckModal = () => {
  const router = useRouter()
  const { t } = useTranslation()
  const [showPayStatusModal, setShowPayStatusModal] = useState(true)
  const anthropicConfirmInfo = useAnthropicCheckPay()
  const freeQuotaConfirmInfo = useCheckFreeQuota()
  const notionConfirmInfo = useCheckNotion()
  const billingConfirmInfo = useBillingPay()

  const handleCancelShowPayStatusModal = useCallback(() => {
    setShowPayStatusModal(false)
    router.replace('/', { forceOptimisticNavigation: false })
  }, [router])

  const confirmInfo = anthropicConfirmInfo || freeQuotaConfirmInfo || notionConfirmInfo || billingConfirmInfo

  if (!confirmInfo || !showPayStatusModal)
    return null

  return (
    <Confirm
      isShow
      onCancel={handleCancelShowPayStatusModal}
      onConfirm={handleCancelShowPayStatusModal}
      type={confirmInfo.type}
      title={confirmInfo.title}
      desc={confirmInfo.desc}
      showOperateCancel={false}
      confirmText={(confirmInfo.type === 'danger' && t('common.operation.ok')) || ''}
    />
  )
}
