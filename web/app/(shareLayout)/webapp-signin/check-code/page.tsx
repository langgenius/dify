'use client'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import Countdown from '@/app/components/signin/countdown'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { sendWebAppEMailLoginCode, webAppEmailLoginWithCode } from '@/service/common'
import I18NContext from '@/context/i18n'
import { setWebAppAccessToken, setWebAppPassport } from '@/service/webapp-auth'
import { fetchAccessToken } from '@/service/share'
import { useWebAppStore } from '@/context/web-app-context'

export default function CheckCode() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const token = decodeURIComponent(searchParams.get('token') as string)
  const [code, setVerifyCode] = useState('')
  const [loading, setIsLoading] = useState(false)
  const { locale } = useContext(I18NContext)
  const redirectUrl = searchParams.get('redirect_url')
  const embeddedUserId = useWebAppStore(s => s.embeddedUserId)

  const getAppCodeFromRedirectUrl = useCallback(() => {
    if (!redirectUrl)
      return null
    const url = new URL(`${window.location.origin}${decodeURIComponent(redirectUrl)}`)
    const appCode = url.pathname.split('/').pop()
    if (!appCode)
      return null

    return appCode
  }, [redirectUrl])

  const verify = async () => {
    try {
      const appCode = getAppCodeFromRedirectUrl()
      if (!code.trim()) {
        Toast.notify({
          type: 'error',
          message: t('login.checkCode.emptyCode'),
        })
        return
      }
      if (!/\d{6}/.test(code)) {
        Toast.notify({
          type: 'error',
          message: t('login.checkCode.invalidCode'),
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
      setIsLoading(true)
      const ret = await webAppEmailLoginWithCode({ email, code, token })
      if (ret.result === 'success') {
        setWebAppAccessToken(ret.data.access_token)
        const { access_token } = await fetchAccessToken({
          appCode: appCode!,
          userId: embeddedUserId || undefined,
        })
        setWebAppPassport(appCode!, access_token)
        router.replace(decodeURIComponent(redirectUrl))
      }
    }
    catch (error) { console.error(error) }
    finally {
      setIsLoading(false)
    }
  }

  const resendCode = async () => {
    try {
      const ret = await sendWebAppEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(ret.data))
        router.replace(`/webapp-signin/check-code?${params.toString()}`)
      }
    }
    catch (error) { console.error(error) }
  }

  return <div className='flex w-[400px] flex-col gap-3'>
    <div className='inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg'>
      <RiMailSendFill className='h-6 w-6 text-2xl text-text-accent-light-mode-only' />
    </div>
    <div className='pb-4 pt-2'>
      <h2 className='title-4xl-semi-bold text-text-primary'>{t('login.checkCode.checkYourEmail')}</h2>
      <p className='body-md-regular mt-2 text-text-secondary'>
        <span>
          {t('login.checkCode.tipsPrefix')}
          <strong>{email}</strong>
        </span>
        <br />
        {t('login.checkCode.validTime')}
      </p>
    </div>

    <form action="">
      <label htmlFor="code" className='system-md-semibold mb-1 text-text-secondary'>{t('login.checkCode.verificationCode')}</label>
      <Input value={code} onChange={e => setVerifyCode(e.target.value)} maxLength={6} className='mt-1' placeholder={t('login.checkCode.verificationCodePlaceholder') || ''} />
      <Button loading={loading} disabled={loading} className='my-3 w-full' variant='primary' onClick={verify}>{t('login.checkCode.verify')}</Button>
      <Countdown onResend={resendCode} />
    </form>
    <div className='py-2'>
      <div className='h-px bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent'></div>
    </div>
    <div onClick={() => router.back()} className='flex h-9 cursor-pointer items-center justify-center text-text-tertiary'>
      <div className='bg-background-default-dimm inline-block rounded-full p-1'>
        <RiArrowLeftLine size={12} />
      </div>
      <span className='system-xs-regular ml-2'>{t('login.back')}</span>
    </div>
  </div>
}
