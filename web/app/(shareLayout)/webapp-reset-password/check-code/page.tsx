'use client'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Countdown from '@/app/components/signin/countdown'
import { useLocale } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendWebAppResetPasswordCode, verifyWebAppResetPasswordCode } from '@/service/common'

export default function CheckCode() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const token = decodeURIComponent(searchParams.get('token') as string)
  const [code, setVerifyCode] = useState('')
  const [loading, setIsLoading] = useState(false)
  const locale = useLocale()
  const pageTitle = t(($) => $['checkCode.checkYourEmail'], { ns: 'login' })
  useDocumentTitle(pageTitle)

  const verify = async () => {
    try {
      if (!code.trim()) {
        toast.error(t(($) => $['checkCode.emptyCode'], { ns: 'login' }))
        return
      }
      if (!/\d{6}/.test(code)) {
        toast.error(t(($) => $['checkCode.invalidCode'], { ns: 'login' }))
        return
      }
      setIsLoading(true)
      const ret = await verifyWebAppResetPasswordCode({ email, code, token })
      if (ret.is_valid) {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(ret.token))
        router.push(`/webapp-reset-password/set-password?${params.toString()}`)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const resendCode = async () => {
    try {
      const res = await sendWebAppResetPasswordCode(email, locale)
      if (res.result === 'success') {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(res.data))
        router.replace(`/webapp-reset-password/check-code?${params.toString()}`)
      }
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge text-text-accent-light-mode-only shadow-lg">
        <RiMailSendFill className="size-6 text-2xl" />
      </div>
      <div className="pt-2 pb-4">
        <h1 className="title-4xl-semi-bold text-text-primary">{pageTitle}</h1>
        <p className="mt-2 body-md-regular text-text-secondary">
          <span>
            {t(($) => $['checkCode.tipsPrefix'], { ns: 'login' })}
            <strong>{email}</strong>
          </span>
          <br />
          {t(($) => $['checkCode.validTime'], { ns: 'login' })}
        </p>
      </div>

      <form action="">
        <input type="text" className="hidden" />
        <label htmlFor="code" className="mb-1 system-md-semibold text-text-secondary">
          {t(($) => $['checkCode.verificationCode'], { ns: 'login' })}
        </label>
        <Input
          value={code}
          onChange={(e) => setVerifyCode(e.target.value)}
          maxLength={6}
          className="mt-1"
          placeholder={t(($) => $['checkCode.verificationCodePlaceholder'], { ns: 'login' }) || ''}
        />
        <Button
          loading={loading}
          disabled={loading}
          className="my-3 w-full"
          variant="primary"
          onClick={verify}
        >
          {t(($) => $['checkCode.verify'], { ns: 'login' })}
        </Button>
        <Countdown onResend={resendCode} />
      </form>
      <div className="py-2">
        <div className="h-px bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <button
        type="button"
        onClick={() => router.back()}
        className="flex h-9 cursor-pointer appearance-none items-center justify-center text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <span className="bg-background-default-dimm inline-block rounded-full p-1">
          <RiArrowLeftLine aria-hidden size={12} />
        </span>
        <span className="ml-2 system-xs-regular">{t(($) => $.back, { ns: 'login' })}</span>
      </button>
    </div>
  )
}
