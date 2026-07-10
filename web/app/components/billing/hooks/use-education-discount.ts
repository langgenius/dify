'use client'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { fetchSubscriptionUrls } from '@/service/billing'
import { BillingPermission, hasPermission } from '@/utils/permission'
import { Plan } from '../type'

export const useEducationDiscount = () => {
  const { t } = useTranslation()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const [isEducationDiscountLoading, setIsEducationDiscountLoading] = useState(false)
  const canManageBilling = hasPermission(workspacePermissionKeys, BillingPermission.Manage)

  const handleEducationDiscount = useCallback(async () => {
    if (isEducationDiscountLoading)
      return

    if (!canManageBilling) {
      toast.error(t($ => $.buyPermissionDeniedTip, { ns: 'billing' }))
      return
    }

    setIsEducationDiscountLoading(true)
    try {
      const res = await fetchSubscriptionUrls(Plan.professional, 'year')
      window.location.href = res.url
    }
    finally {
      setIsEducationDiscountLoading(false)
    }
  }, [canManageBilling, isEducationDiscountLoading, t])

  return {
    handleEducationDiscount,
    isEducationDiscountLoading,
  }
}
