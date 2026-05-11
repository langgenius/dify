'use client'

import { useEffect } from 'react'
import EducationApplyPage from '@/app/education-apply/education-apply-page'
import RootLoading from '@/app/loading'
import { useProviderContext } from '@/context/provider-context'
import {
  useRouter,
  useSearchParams,
} from '@/next/navigation'

export default function EducationApply() {
  const router = useRouter()
  const {
    enableEducationPlan,
    isFetchedPlanInfo,
    isLoadingEducationAccountInfo,
  } = useProviderContext()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  useEffect(() => {
    if (!isFetchedPlanInfo)
      return

    if (!enableEducationPlan || !token)
      router.replace('/')
  }, [enableEducationPlan, isFetchedPlanInfo, router, token])

  if (!isFetchedPlanInfo || !enableEducationPlan || !token || isLoadingEducationAccountInfo)
    return <RootLoading />

  return <EducationApplyPage />
}
