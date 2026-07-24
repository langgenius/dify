'use client'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { fetchSubscriptionUrls } from '@/service/billing'
import { Plan } from '../type'

export const useEducationDiscount = () => {
  const { t } = useTranslation()
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
      const res = await fetchSubscriptionUrls(Plan.professional, 'year')
      window.location.href = res.url
    } finally {
      setIsEducationDiscountLoading(false)
    }
  }, [isCurrentWorkspaceManager, isEducationDiscountLoading, t])

  return {
    handleEducationDiscount,
    isEducationDiscountLoading,
  }
}
