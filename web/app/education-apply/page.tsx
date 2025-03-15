'use client'

import {
  useEffect,
  useMemo,
} from 'react'
import { useRouter } from 'next/navigation'
import EducationApplyAge from './components/education-apply-page'
import { useProviderContext } from '@/context/provider-context'

export default function EducationApply() {
  const router = useRouter()
  const { enableEducationPlan, isEducationAccount } = useProviderContext()
  const hiddenEducationApply = useMemo(() => {
    return enableEducationPlan && isEducationAccount
  }, [enableEducationPlan, isEducationAccount])

  useEffect(() => {
    if (hiddenEducationApply)
      router.replace('/')
  }, [hiddenEducationApply, router])

  return <EducationApplyAge />
}
