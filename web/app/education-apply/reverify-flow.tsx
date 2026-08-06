'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FullScreenLoading } from '@/app/components/full-screen-loading'
import { useRouter } from '@/next/navigation'
import { useEducationVerify } from '@/service/use-education'
import VerifyStateModal from './verify-state-modal'

export function EducationReverifyFlow() {
  const { t } = useTranslation()
  const router = useRouter()
  const verificationStartedRef = useRef(false)
  const { isError, mutate } = useEducationVerify()

  const startVerification = useCallback(() => {
    if (verificationStartedRef.current) return

    verificationStartedRef.current = true
    mutate(undefined, {
      onSuccess: ({ token }) => {
        router.replace(`/education-apply?token=${token}`)
      },
    })
  }, [mutate, router])

  useEffect(() => {
    startVerification()
  }, [startVerification])

  if (!isError) return <FullScreenLoading />

  return (
    <VerifyStateModal
      isShow
      title={t(($) => $['errorBoundary.title'], { ns: 'common' })}
      confirmText={t(($) => $['errorBoundary.tryAgain'], { ns: 'common' })}
      onConfirm={() => {
        verificationStartedRef.current = false
        startVerification()
      }}
      onCancel={() => router.replace('/apps')}
    />
  )
}
