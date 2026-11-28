'use client'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleClient } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getBillingErrorMessage } from '../billing-error'

export function useEducationDiscount() {
  const { t } = useTranslation(['billing'])
  const describeRequestError = useRequestErrorDescriber()
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const [isEducationDiscountLoading, setIsEducationDiscountLoading] = useState(false)

  const handleEducationDiscount = useCallback(async () => {
    if (isEducationDiscountLoading) return

    if (!isCurrentWorkspaceManager) {
      toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
      return
    }

    setIsEducationDiscountLoading(true)
    try {
      const { url } = await consoleClient.billing.subscription.get({
        query: { plan: 'professional', interval: 'year' },
      })
      window.location.href = url
    } catch (error) {
      toast.error(getBillingErrorMessage(error, t, describeRequestError))
    } finally {
      setIsEducationDiscountLoading(false)
    }
  }, [isCurrentWorkspaceManager, isEducationDiscountLoading, t, describeRequestError])

  return {
    handleEducationDiscount,
    isEducationDiscountLoading,
  }
}
