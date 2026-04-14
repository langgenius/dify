import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '@/app/components/signin/countdown'
import { emailRegex } from '@/config'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendWebAppEMailLoginCode } from '@/service/common'

export default function MailAndCodeAuth() {
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
        toast.error(t('error.emailEmpty', { ns: 'login' }))
        return
      }

      if (!emailRegex.test(email)) {
        toast.error(t('error.emailInValid', { ns: 'login' }))
        return
      }
      setIsLoading(true)
      const ret = await sendWebAppEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        localStorage.setItem(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('email', encodeURIComponent(email))
        params.set('token', encodeURIComponent(ret.data))
        router.push(`/webapp-signin/check-code?${params.toString()}`)
      }
    }
    catch (error) {
      console.error(error)
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={noop}>
      <input type="text" className="hidden" />
      <div className="mb-2">
        <label htmlFor="email" className="my-2 system-md-semibold text-text-secondary">{t('email', { ns: 'login' })}</label>
        <div className="mt-1">
          <Input id="email" type="email" value={email} placeholder={t('emailPlaceholder', { ns: 'login' }) as string} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="mt-3">
          <Button loading={loading} disabled={loading || !email} variant="primary" className="w-full" onClick={handleGetEMailVerificationCode}>{t('signup.verifyMail', { ns: 'login' })}</Button>
        </div>
      </div>
    </form>
  )
}
