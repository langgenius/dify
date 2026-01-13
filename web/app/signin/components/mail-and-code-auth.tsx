import type { FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/countdown'
import { emailRegex } from '@/config'
import { useLocale } from '@/context/i18n'
import { sendEMailLoginCode } from '@/service/common'

type MailAndCodeAuthProps = {
  isInvite: boolean
}

export default function MailAndCodeAuth({ isInvite }: MailAndCodeAuthProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [loading, setIsLoading] = useState(false)
  const locale = useLocale()

  const handleGetEMailVerificationCode = async () => {
    try {
      if (!email) {
        Toast.notify({ type: 'error', message: t('error.emailEmpty', { ns: 'login' }) })
        return
      }

      if (!emailRegex.test(email)) {
        Toast.notify({
          type: 'error',
          message: t('error.emailInValid', { ns: 'login' }),
        })
        return
      }
      setIsLoading(true)
      const ret = await sendEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        localStorage.setItem(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('email', encodeURIComponent(email))
        params.set('token', encodeURIComponent(ret.data))
        router.push(`/signin/check-code?${params.toString()}`)
      }
    }
    catch (error) {
      console.error(error)
    }
    finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleGetEMailVerificationCode()
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="text" className="hidden" />
      <div className="mb-2">
        <label htmlFor="email" className="system-md-semibold my-2 text-text-secondary">{t('email', { ns: 'login' })}</label>
        <div className="mt-1">
          <Input id="email" type="email" disabled={isInvite} value={email} placeholder={t('emailPlaceholder', { ns: 'login' }) as string} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="mt-3">
          <Button type="submit" loading={loading} disabled={loading || !email} variant="primary" className="w-full">{t('signup.verifyMail', { ns: 'login' })}</Button>
        </div>
      </div>
    </form>
  )
}
