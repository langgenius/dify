'use client'
import type { MailSendResponse, MailValidityResponse } from '@/service/use-common'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import Countdown from '@/app/components/signin/countdown'
import { useLocale } from '@/context/i18n'
import { useMailValidity, useSendMail } from '@/service/use-common'

export default function CheckCode() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const [token, setToken] = useState(decodeURIComponent(searchParams.get('token') as string))
  const [code, setVerifyCode] = useState('')
  const [loading, setIsLoading] = useState(false)
  const locale = useLocale()
  const { mutateAsync: submitMail } = useSendMail()
  const { mutateAsync: verifyCode } = useMailValidity()

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
      const res = await verifyCode({ email, code, token })
      if ((res as MailValidityResponse).is_valid) {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent((res as MailValidityResponse).token))
        router.push(`/signup/set-password?${params.toString()}`)
      }
      else {
        Toast.notify({
          type: 'error',
          message: t('checkCode.invalidCode', { ns: 'login' }),
        })
      }
    }
    catch (error) { console.error(error) }
    finally {
      setIsLoading(false)
    }
  }

  const resendCode = async () => {
    try {
      const res = await submitMail({ email, language: locale })
      if ((res as MailSendResponse).result === 'success') {
        const params = new URLSearchParams(searchParams)
        const newToken = (res as MailSendResponse)?.data
        params.set('token', encodeURIComponent(newToken))
        setToken(newToken)
        router.replace(`/signup/check-code?${params.toString()}`)
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

      <form action="">
        <label htmlFor="code" className="system-md-semibold mb-1 text-text-secondary">{t('checkCode.verificationCode', { ns: 'login' })}</label>
        <Input value={code} onChange={e => setVerifyCode(e.target.value)} maxLength={6} className="mt-1" placeholder={t('checkCode.verificationCodePlaceholder', { ns: 'login' }) as string} />
        <Button loading={loading} disabled={loading} className="my-3 w-full" variant="primary" onClick={verify}>{t('checkCode.verify', { ns: 'login' })}</Button>
        <Countdown onResend={resendCode} />
      </form>
      <div className="py-2">
        <div className="h-px bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <div onClick={() => router.back()} className="flex h-9 cursor-pointer items-center justify-center text-text-tertiary">
        <div className="bg-background-default-dimm inline-block rounded-full p-1">
          <RiArrowLeftLine size={12} />
        </div>
        <span className="system-xs-regular ml-2">{t('back', { ns: 'login' })}</span>
      </div>
    </div>
  )
}
