'use client'

import { useEffect } from 'react'
import {
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import { useSearchParams } from '@/next/navigation'

export function EducationVerifyActionRecorder() {
  const searchParams = useSearchParams()

  useEffect(() => {
    if (searchParams.get('action') === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
      localStorage.setItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, 'yes')
  }, [searchParams])

  return null
}
