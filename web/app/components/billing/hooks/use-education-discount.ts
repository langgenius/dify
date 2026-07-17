'use client'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/client'
import { BillingPermission, hasPermission } from '@/utils/permission'

export const useEducationDiscount = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const [isEducationDiscountLoading, setIsEducationDiscountLoading] = useState(false)
  const canManageBilling = hasPermission(workspacePermissionKeys, BillingPermission.Manage)

  const handleEducationDiscount = useCallback(async () => {
    if (isEducationDiscountLoading) return

    if (!canManageBilling) {
      toast.error(t(($) => $.buyPermissionDeniedTip, { ns: 'billing' }))
      return
    }

    setIsEducationDiscountLoading(true)
    try {
      const res = await queryClient.fetchQuery(
        consoleQuery.billing.subscription.get.queryOptions({
          input: {
            query: {
              plan: 'professional',
              interval: 'year',
            },
          },
        }),
      )
      window.location.href = res.url
    } finally {
      setIsEducationDiscountLoading(false)
    }
  }, [canManageBilling, isEducationDiscountLoading, queryClient, t])

  return {
    handleEducationDiscount,
    isEducationDiscountLoading,
  }
}
