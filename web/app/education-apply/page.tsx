'use client'

import {
  useEffect,
  useMemo,
} from 'react'
import { useRouter } from 'next/navigation'
import EducationApplyAge from './components/education-apply-page'
import { IS_CE_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { LicenseStatus } from '@/types/feature'

export default function EducationApply() {
  const router = useRouter()
  const { systemFeatures } = useAppContext()
  const hiddenEducationApply = useMemo(() => {
    return IS_CE_EDITION || (systemFeatures.license.status !== LicenseStatus.NONE)
  }, [systemFeatures.license.status])

  useEffect(() => {
    if (hiddenEducationApply)
      router.replace('/')
  }, [hiddenEducationApply, router])

  return <EducationApplyAge />
}
