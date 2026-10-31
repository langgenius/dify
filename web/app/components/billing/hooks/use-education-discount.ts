'use client'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { consoleClient } from '@/service/console'
import { useBillingErrorMessage } from './use-billing-error-message'

export function useEducationDiscount() {
  const { t } = useTranslation(['billing'])
  const isCurrentWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const [isEducationDiscountLoading, setIsEducationDiscountLoading] = useState(false)
  const getBillingErrorMessage = useBillingErrorMessage()

  const handleEducationDiscount = useCallback(async () => {
    if (isEducationDiscountLoading) return

    if (!isCurrentWorkspaceManager) {
      toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
      return
    }

    setIsEducationDiscountLoading(true)
    try {
      const { url } = await consoleClient.billing.subscription.get(
        { query: { plan: 'professional', interval: 'year' } },
        { context: { silent: true } },
      )
      window.location.href = url
    } catch (error) {
      toast.error(getBillingErrorMessage(error))
    } finally {
      setIsEducationDiscountLoading(false)
    }
  }, [getBillingErrorMessage, isCurrentWorkspaceManager, isEducationDiscountLoading, t])

  return {
    handleEducationDiscount,
    isEducationDiscountLoading,
  }
}
