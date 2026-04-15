'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useNotionBinding } from '@/service/use-common'

type ConfirmType = {
  type: 'info' | 'warning'
  title: string
}

const useAnthropicCheckPay = () => {
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

const useBillingPay = () => {
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

const useCheckNotion = () => {
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

  const description = (confirmInfo as { desc?: string }).desc || ''

  return (
    <AlertDialog open={showPayStatusModal} onOpenChange={open => !open && handleCancelShowPayStatusModal()}>
      <AlertDialogContent>
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
            {confirmInfo.title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {description}
            </AlertDialogDescription>
          )}
        </div>
        <AlertDialogActions>
          <AlertDialogConfirmButton
            tone={confirmInfo.type !== 'info' ? 'destructive' : 'default'}
            onClick={handleCancelShowPayStatusModal}
          >
            {confirmInfo.type === 'info'
              ? t('operation.ok', { ns: 'common' })
              : t('operation.confirm', { ns: 'common' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}
