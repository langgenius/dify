'use client'

import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import EducationApplyPage from '@/app/education-apply/education-apply-page'
import RootLoading from '@/app/loading'
import { useProviderContext } from '@/context/provider-context'
import useDocumentTitle from '@/hooks/use-document-title'
import {
  useRouter,
  useSearchParams,
} from '@/next/navigation'

export default function EducationApply() {
  const { t } = useTranslation()
  const router = useRouter()
  const {
    enableEducationPlan,
    isFetchedPlanInfo,
    isLoadingEducationAccountInfo,
  } = useProviderContext()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  useDocumentTitle(t('pageTitle.verification', { ns: 'education' }))

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
