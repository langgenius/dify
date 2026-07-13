import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { noop } from 'es-toolkit/function'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveWebAppLoginRedirect } from '@/app/(shareLayout)/webapp-signin/login-redirect'
import Input from '@/app/components/base/input'
import { COUNT_DOWN_TIME_MS, useSetCountdownLeftTime } from '@/app/components/signin/storage'
import { emailRegex, IS_CLOUD_EDITION } from '@/config'
import { useLocale } from '@/context/i18n'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendWebAppEMailLoginCode } from '@/service/common'
import { getClientLoginFallback } from '@/utils/login-redirect'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'

export default function MailAndCodeAuth() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [loading, setLoading] = useState(false)
  const locale = useLocale()
  const setCountdownLeftTime = useSetCountdownLeftTime()
  const redirectUrl = searchParams.get('redirect_url')

  useEffect(() => {
    if (!resolveWebAppLoginRedirect(redirectUrl, window.location.origin))
      replaceLoginRedirect(getClientLoginFallback(IS_CLOUD_EDITION), router.replace, basePath)
  }, [redirectUrl, router])

  const handleGetEMailVerificationCode = async () => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (!loginRedirect) {
      replaceLoginRedirect(getClientLoginFallback(IS_CLOUD_EDITION), router.replace, basePath)
      return
    }
    try {
      if (!email) {
        toast.error(t('error.emailEmpty', { ns: 'login' }))
        return
      }

      if (!emailRegex.test(email)) {
        toast.error(t('error.emailInValid', { ns: 'login' }))
        return
      }
      setLoading(true)
      const ret = await sendWebAppEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        setCountdownLeftTime(`${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('email', encodeURIComponent(email))
        params.set('token', encodeURIComponent(ret.data))
        params.set('redirect_url', loginRedirect.target.href)
        router.push(`/webapp-signin/check-code?${params.toString()}`)
      }
    }
    catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
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
