'use client'

import {
  useRouter,
  useSearchParams,
} from 'next/navigation'
import {
  useEffect,
  useMemo,
} from 'react'
import EducationApplyPage from '@/app/education-apply/education-apply-page'
import { useProviderContext } from '@/context/provider-context'

export default function EducationApply() {
  const router = useRouter()
  const { enableEducationPlan } = useProviderContext()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const showEducationApplyPage = useMemo(() => {
    return enableEducationPlan && token
  }, [enableEducationPlan, token])

  useEffect(() => {
    if (!showEducationApplyPage)
      router.replace('/')
  }, [showEducationApplyPage, router])

  return <EducationApplyPage />
}
