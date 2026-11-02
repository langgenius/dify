'use client'

import { skipToken, useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type CheckResult = {
  type: 'success' | 'warning' | 'error'
  title: string
}

const usePayResult = (): CheckResult | null => {
  const { t } = useTranslation(['common'])
  const searchParams = useSearchParams()
  const isPayment =
    searchParams.get('provider_name') === 'anthropic' ||
    searchParams.get('payment_type') === 'billing'
  const paymentResult = searchParams.get('payment_result')

  if (!isPayment) return null
  if (paymentResult === 'succeeded')
    return { type: 'success', title: t(($) => $['actionMsg.paySucceeded'], { ns: 'common' }) }
  if (paymentResult === 'cancelled')
    return { type: 'warning', title: t(($) => $['actionMsg.payCancelled'], { ns: 'common' }) }
  return null
}

const useCheckNotion = (): CheckResult | null => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isNotion = searchParams.get('type') === 'notion'
  const notionCode = searchParams.get('code')
  const notionError = searchParams.get('error')
  const { data } = useQuery(
    consoleQuery.oauth.dataSource.binding.byProvider.get.queryOptions({
      input:
        isNotion && notionCode && !notionError
          ? { params: { provider: 'notion' }, query: { code: notionCode } }
          : skipToken,
    }),
  )

  useEffect(() => {
    if (data) router.replace('/')
  }, [data, router])

  return isNotion && notionError ? { type: 'error', title: notionError } : null
}

export const CheckResultToast = () => {
  const router = useRouter()
  const payResult = usePayResult()
  const notionResult = useCheckNotion()
  const result = payResult ?? notionResult
  const shownRef = useRef(false)

  useEffect(() => {
    if (!result || shownRef.current) return
    shownRef.current = true
    toast[result.type](result.title)
    router.replace('/')
  }, [result, router])

  return null
}
