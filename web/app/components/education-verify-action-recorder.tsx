'use client'

import { useSetLocalStorage } from 'foxact/use-local-storage'
import { useEffect } from 'react'
import {
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import { useSearchParams } from '@/next/navigation'

export function EducationVerifyActionRecorder() {
  const searchParams = useSearchParams()
  const setEducationVerifying = useSetLocalStorage<string>(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM, { raw: true })

  useEffect(() => {
    if (searchParams.get('action') === EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION)
      setEducationVerifying('yes')
  }, [searchParams, setEducationVerifying])

  return null
}
