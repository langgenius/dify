'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import MailForm from './components/input-mail'

const Signup = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useTranslation()

  const handleInputMailSubmitted = useCallback((email: string, result: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('token', encodeURIComponent(result))
    params.set('email', encodeURIComponent(email))
    router.push(`/signup/check-code?${params.toString()}`)
  }, [router, searchParams])

  return (
    <div className="mx-auto mt-8 w-full">
      <div className="mx-auto mb-10 w-full">
        <h2 className="title-4xl-semi-bold text-text-primary">{t('signup.createAccount', { ns: 'login' })}</h2>
        <p className="body-md-regular mt-2 text-text-tertiary">{t('signup.welcome', { ns: 'login' })}</p>
      </div>
      <MailForm onSuccess={handleInputMailSubmitted} />
    </div>
  )
}

export default Signup
