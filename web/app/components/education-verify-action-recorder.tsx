'use client'

import { useEffect } from 'react'
import { EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION } from '@/app/education-apply/constants'
import { useSetEducationVerifying } from '@/app/education-apply/storage'
import { useSearchParams } from '@/next/navigation'

export function EducationVerifyActionRecorder() {
  const searchParams = useSearchParams()
  const setEducationVerifying = useSetEducationVerifying()

  useEffect(() => {
    if (searchParams.get('action') === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
      setEducationVerifying('yes')
  }, [searchParams, setEducationVerifying])

  return null
}
