'use client'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import MailForm from './components/input-mail'

const Signup = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useTranslation()
  const pageTitle = t(($) => $['signup.createAccount'], { ns: 'login' })
  useDocumentTitle(pageTitle)

  const handleInputMailSubmitted = useCallback(
    (email: string, result: string) => {
      const params = new URLSearchParams(searchParams)
      params.set('token', encodeURIComponent(result))
      params.set('email', encodeURIComponent(email))
      router.push(`/signup/check-code?${params.toString()}`)
    },
    [router, searchParams],
  )

  return (
    <div className="mx-auto mt-8 w-full">
      <div className="mx-auto mb-10 w-full">
        <h1 className="title-4xl-semi-bold text-text-primary">{pageTitle}</h1>
        <p className="mt-2 body-md-regular text-text-tertiary">
          {t(($) => $['signup.welcome'], { ns: 'login' })}
        </p>
      </div>
      <MailForm onSuccess={handleInputMailSubmitted} />
    </div>
  )
}

export default Signup
