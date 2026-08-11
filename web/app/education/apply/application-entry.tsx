'use client'

import { useEffect } from 'react'
import { useProviderContextSelector } from '@/context/provider-context'
import { useRouter, useSearchParams } from '@/next/navigation'
import { EDUCATION_APPLICATIONS_PAUSED } from '../constants'
import { EducationPausedContent } from '../paused-content'
import EducationApplyPage from './application-form'

export default function EducationApplyRoute() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const enableEducationPlan = useProviderContextSelector((state) => state.enableEducationPlan)
  const isFetchedPlanInfo = useProviderContextSelector((state) => state.isFetchedPlanInfo)

  useEffect(() => {
    if (!isFetchedPlanInfo) return

    if (!enableEducationPlan) router.replace('/')
    else if (!token) router.replace('/education/verify')
  }, [enableEducationPlan, isFetchedPlanInfo, router, token])

  if (!isFetchedPlanInfo || !enableEducationPlan || !token) return null

  if (EDUCATION_APPLICATIONS_PAUSED) return <EducationPausedContent />

  return <EducationApplyPage token={token} />
}
