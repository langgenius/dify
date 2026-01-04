'use client'

import type { IConfirm } from '@/app/components/base/confirm'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'
import { useNotionBinding } from '@/service/use-common'

export type ConfirmType = Pick<IConfirm, 'type' | 'title' | 'content'>

export const useAnthropicCheckPay = () => {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const searchParams = useSearchParams()
  const providerName = searchParams.get('provider_name')
  const paymentResult = searchParams.get('payment_result')

  useEffect(() => {
    if (providerName === 'anthropic' && (paymentResult === 'succeeded' || paymentResult === 'cancelled')) {
      setConfirm({
        type: paymentResult === 'succeeded' ? 'info' : 'warning',
        title: paymentResult === 'succeeded' ? t('actionMsg.paySucceeded', { ns: 'common' }) : t('actionMsg.payCancelled', { ns: 'common' }),
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
        type: paymentResult === 'succeeded' ? 'info' : 'warning',
        title: paymentResult === 'succeeded' ? t('actionMsg.paySucceeded', { ns: 'common' }) : t('actionMsg.payCancelled', { ns: 'common' }),
      })
    }
  }, [paymentType, paymentResult, t])

  return confirm
}

export const useCheckNotion = () => {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const [canBinding, setCanBinding] = useState(false)
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const notionCode = searchParams.get('code')
  const notionError = searchParams.get('error')
  const { data } = useNotionBinding(notionCode, canBinding)

  useEffect(() => {
    if (data)
      router.replace('/')
  }, [data, router])
  useEffect(() => {
    if (type === 'notion') {
      if (notionError) {
        setConfirm({
          type: 'warning',
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
  const notionConfirmInfo = useCheckNotion()
  const billingConfirmInfo = useBillingPay()

  const handleCancelShowPayStatusModal = useCallback(() => {
    setShowPayStatusModal(false)
    router.replace('/')
  }, [router])

  const confirmInfo = anthropicConfirmInfo || notionConfirmInfo || billingConfirmInfo

  if (!confirmInfo || !showPayStatusModal)
    return null

  return (
    <Confirm
      isShow
      onCancel={handleCancelShowPayStatusModal}
      onConfirm={handleCancelShowPayStatusModal}
      showCancel={false}
      type={confirmInfo.type === 'info' ? 'info' : 'warning'}
      title={confirmInfo.title}
      content={(confirmInfo as unknown as { desc: string }).desc || ''}
      confirmText={(confirmInfo.type === 'info' && t('operation.ok', { ns: 'common' })) || ''}
    />
  )
}
