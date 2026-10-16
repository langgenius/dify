'use client'

import {
  AlertDialog,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type ConfirmType = {
  type: 'info' | 'warning'
  title: string
}

const useAnthropicCheckPay = () => {
  const { t } = useTranslation(['common'])
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const searchParams = useSearchParams()
  const providerName = searchParams.get('provider_name')
  const paymentResult = searchParams.get('payment_result')

  useEffect(() => {
    if (
      providerName === 'anthropic' &&
      (paymentResult === 'succeeded' || paymentResult === 'cancelled')
    ) {
      setConfirm({
        type: paymentResult === 'succeeded' ? 'info' : 'warning',
        title:
          paymentResult === 'succeeded'
            ? t(($) => $['actionMsg.paySucceeded'], { ns: 'common' })
            : t(($) => $['actionMsg.payCancelled'], { ns: 'common' }),
      })
    }
  }, [providerName, paymentResult, t])

  return confirm
}

const useBillingPay = () => {
  const { t } = useTranslation(['common'])
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const searchParams = useSearchParams()
  const paymentType = searchParams.get('payment_type')
  const paymentResult = searchParams.get('payment_result')

  useEffect(() => {
    if (
      paymentType === 'billing' &&
      (paymentResult === 'succeeded' || paymentResult === 'cancelled')
    ) {
      setConfirm({
        type: paymentResult === 'succeeded' ? 'info' : 'warning',
        title:
          paymentResult === 'succeeded'
            ? t(($) => $['actionMsg.paySucceeded'], { ns: 'common' })
            : t(($) => $['actionMsg.payCancelled'], { ns: 'common' }),
      })
    }
  }, [paymentType, paymentResult, t])

  return confirm
}

const useCheckNotion = () => {
  const router = useRouter()
  const [confirm, setConfirm] = useState<ConfirmType | null>(null)
  const [canBinding, setCanBinding] = useState(false)
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const notionCode = searchParams.get('code')
  const notionError = searchParams.get('error')
  const { data } = useQuery(
    consoleQuery.oauth.dataSource.binding.byProvider.get.queryOptions({
      input:
        notionCode && canBinding
          ? { params: { provider: 'notion' }, query: { code: notionCode } }
          : skipToken,
    }),
  )

  useEffect(() => {
    if (data) router.replace('/')
  }, [data, router])
  useEffect(() => {
    if (type === 'notion') {
      if (notionError) {
        setConfirm({
          type: 'warning',
          title: notionError,
        })
      } else if (notionCode) {
        setCanBinding(true)
      }
    }
  }, [type, notionCode, notionError])

  return confirm
}

export const CheckModal = () => {
  const router = useRouter()
  const { t } = useTranslation(['common'])
  const [showPayStatusModal, setShowPayStatusModal] = useState(true)
  const anthropicConfirmInfo = useAnthropicCheckPay()
  const notionConfirmInfo = useCheckNotion()
  const billingConfirmInfo = useBillingPay()

  const handleCancelShowPayStatusModal = useCallback(() => {
    setShowPayStatusModal(false)
    router.replace('/')
  }, [router])

  const confirmInfo = anthropicConfirmInfo || notionConfirmInfo || billingConfirmInfo

  if (!confirmInfo) return null

  const description = (confirmInfo as { desc?: string }).desc || ''

  return (
    <AlertDialog
      open={showPayStatusModal}
      onOpenChange={(open) => !open && handleCancelShowPayStatusModal()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="truncate">{confirmInfo.title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogConfirmButton
            tone={confirmInfo.type !== 'info' ? 'destructive' : 'default'}
            onClick={handleCancelShowPayStatusModal}
          >
            {confirmInfo.type === 'info'
              ? t(($) => $['operation.ok'], { ns: 'common' })
              : t(($) => $['operation.confirm'], { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
