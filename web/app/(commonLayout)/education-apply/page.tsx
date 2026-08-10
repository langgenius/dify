'use client'

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FullScreenLoading } from '@/app/components/full-screen-loading'
import EducationApplyPage from '@/app/education-apply/education-apply-page'
import { useProviderContext } from '@/context/provider-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'

export default function EducationApply() {
  const { t } = useTranslation()
  useDocumentTitle(t(($) => $.toVerified, { ns: 'education' }))
  const router = useRouter()
  const { enableEducationPlan, isFetchedPlanInfo } = useProviderContext()
  const { isLoading: isLoadingEducationStatus } = useQuery(
    consoleQuery.account.education.get.queryOptions({ enabled: enableEducationPlan }),
  )
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  useEffect(() => {
    if (!isFetchedPlanInfo) return

    if (!enableEducationPlan || !token) router.replace('/')
  }, [enableEducationPlan, isFetchedPlanInfo, router, token])

  if (!isFetchedPlanInfo || !enableEducationPlan || !token || isLoadingEducationStatus)
    return <FullScreenLoading />

  return <EducationApplyPage />
}
