'use client'
import type { FormEvent } from 'react'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import Countdown from '@/app/components/signin/countdown'

import { useLocale } from '@/context/i18n'
import { emailLoginWithCode, sendEMailLoginCode } from '@/service/common'
import { encryptVerificationCode } from '@/utils/encryption'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

export default function CheckCode() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const token = decodeURIComponent(searchParams.get('token') as string)
  const invite_token = decodeURIComponent(searchParams.get('invite_token') || '')
  const language = i18n.language
  const [code, setVerifyCode] = useState('')
  const [loading, setIsLoading] = useState(false)
  const locale = useLocale()
  const codeInputRef = useRef<HTMLInputElement>(null)

  const verify = async () => {
    try {
      if (!code.trim()) {
        Toast.notify({
          type: 'error',
          message: t('checkCode.emptyCode', { ns: 'login' }),
        })
        return
      }
      if (!/\d{6}/.test(code)) {
        Toast.notify({
          type: 'error',
          message: t('checkCode.invalidCode', { ns: 'login' }),
        })
        return
      }
      setIsLoading(true)
      const ret = await emailLoginWithCode({ email, code: encryptVerificationCode(code), token, language })
      if (ret.result === 'success') {
        // Track login success event
        trackEvent('user_login_success', {
          method: 'email_code',
          is_invite: !!invite_token,
        })

        if (invite_token) {
          router.replace(`/signin/invite-settings?${searchParams.toString()}`)
        }
        else {
          const redirectUrl = resolvePostLoginRedirect(searchParams)
          router.replace(redirectUrl || '/apps')
        }
      }
    }
    catch (error) { console.error(error) }
    finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    verify()
  }

  useEffect(() => {
    codeInputRef.current?.focus()
  }, [])

  const resendCode = async () => {
    try {
      const ret = await sendEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(ret.data))
        router.replace(`/signin/check-code?${params.toString()}`)
      }
    }
    catch (error) { console.error(error) }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg">
        <RiMailSendFill className="h-6 w-6 text-2xl text-text-accent-light-mode-only" />
      </div>
      <div className="pb-4 pt-2">
        <h2 className="title-4xl-semi-bold text-text-primary">{t('checkCode.checkYourEmail', { ns: 'login' })}</h2>
        <p className="body-md-regular mt-2 text-text-secondary">
          <span>
            {t('checkCode.tipsPrefix', { ns: 'login' })}
            <strong>{email}</strong>
          </span>
          <br />
          {t('checkCode.validTime', { ns: 'login' })}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="code" className="system-md-semibold mb-1 text-text-secondary">{t('checkCode.verificationCode', { ns: 'login' })}</label>
        <Input
          ref={codeInputRef}
          id="code"
          value={code}
          onChange={e => setVerifyCode(e.target.value)}
          maxLength={6}
          className="mt-1"
          placeholder={t('checkCode.verificationCodePlaceholder', { ns: 'login' }) as string}
        />
        <Button type="submit" loading={loading} disabled={loading} className="my-3 w-full" variant="primary">{t('checkCode.verify', { ns: 'login' })}</Button>
        <Countdown onResend={resendCode} />
      </form>
      <div className="py-2">
        <div className="h-px bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <div onClick={() => router.back()} className="flex h-9 cursor-pointer items-center justify-center text-text-tertiary">
        <div className="inline-block rounded-full bg-background-default-dimmed p-1">
          <RiArrowLeftLine size={12} />
        </div>
        <span className="system-xs-regular ml-2">{t('back', { ns: 'login' })}</span>
      </div>
    </div>
  )
}
