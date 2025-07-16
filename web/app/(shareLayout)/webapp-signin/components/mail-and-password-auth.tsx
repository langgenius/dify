'use client'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import { emailRegex } from '@/config'
import { webAppLogin } from '@/service/common'
import Input from '@/app/components/base/input'
import I18NContext from '@/context/i18n'
import { noop } from 'lodash-es'
import { setAccessToken } from '@/app/components/share/utils'
import { fetchAccessToken } from '@/service/share'

type MailAndPasswordAuthProps = {
  isEmailSetup: boolean
}

const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

export default function MailAndPasswordAuth({ isEmailSetup }: MailAndPasswordAuthProps) {
  const { t } = useTranslation()
  const { locale } = useContext(I18NContext)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [password, setPassword] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const redirectUrl = searchParams.get('redirect_url')

  const getAppCodeFromRedirectUrl = useCallback(() => {
    if (!redirectUrl)
      return null
    const url = new URL(`${window.location.origin}${decodeURIComponent(redirectUrl)}`)
    const appCode = url.pathname.split('/').pop()
    if (!appCode)
      return null

    return appCode
  }, [redirectUrl])
  const handleEmailPasswordLogin = async () => {
    const appCode = getAppCodeFromRedirectUrl()
    if (!email) {
      Toast.notify({ type: 'error', message: t('login.error.emailEmpty') })
      return
    }
    if (!emailRegex.test(email)) {
      Toast.notify({
        type: 'error',
        message: t('login.error.emailInValid'),
      })
      return
    }
    if (!password?.trim()) {
      Toast.notify({ type: 'error', message: t('login.error.passwordEmpty') })
      return
    }
    if (!passwordRegex.test(password)) {
      Toast.notify({
        type: 'error',
        message: t('login.error.passwordInvalid'),
      })
      return
    }
    if (!redirectUrl || !appCode) {
      Toast.notify({
        type: 'error',
        message: t('login.error.redirectUrlMissing'),
      })
      return
    }
    try {
      setIsLoading(true)
      const loginData: Record<string, any> = {
        email,
        password,
        language: locale,
        remember_me: true,
      }

      const res = await webAppLogin({
        url: '/login',
        body: loginData,
      })
      if (res.result === 'success') {
        localStorage.setItem('webapp_access_token', res.data.access_token)
        const tokenResp = await fetchAccessToken({ appCode, webAppAccessToken: res.data.access_token })
        await setAccessToken(appCode, tokenResp.access_token)
        router.replace(decodeURIComponent(redirectUrl))
      }
      else {
        Toast.notify({
          type: 'error',
          message: res.data,
        })
      }
    }

    finally {
      setIsLoading(false)
    }
  }

  return <form onSubmit={noop}>
    <div className='mb-3'>
      <label htmlFor="email" className="system-md-semibold my-2 text-text-secondary">
        {t('login.email')}
      </label>
      <div className="mt-1">
        <Input
          value={email}
          onChange={e => setEmail(e.target.value)}
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t('login.emailPlaceholder') || ''}
          tabIndex={1}
        />
      </div>
    </div>

    <div className='mb-3'>
      <label htmlFor="password" className="my-2 flex items-center justify-between">
        <span className='system-md-semibold text-text-secondary'>{t('login.password')}</span>
        <Link
          href={`/webapp-reset-password?${searchParams.toString()}`}
          className={`system-xs-regular ${isEmailSetup ? 'text-components-button-secondary-accent-text' : 'pointer-events-none text-components-button-secondary-accent-text-disabled'}`}
          tabIndex={isEmailSetup ? 0 : -1}
          aria-disabled={!isEmailSetup}
        >
          {t('login.forget')}
        </Link>
      </label>
      <div className="relative mt-1">
        <Input
          id="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              handleEmailPasswordLogin()
          }}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder={t('login.passwordPlaceholder') || ''}
          tabIndex={2}
        />
        <div className="absolute inset-y-0 right-0 flex items-center">
          <Button
            type="button"
            variant='ghost'
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? '👀' : '😝'}
          </Button>
        </div>
      </div>
    </div>

    <div className='mb-2'>
      <Button
        tabIndex={2}
        variant='primary'
        onClick={handleEmailPasswordLogin}
        disabled={isLoading || !email || !password}
        className="w-full"
      >{t('login.signBtn')}</Button>
    </div>
  </form>
}
