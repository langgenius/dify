'use client'
import type { MailSendResponse, MailValidityResponse } from '@/service/use-common'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Countdown from '@/app/components/signin/countdown'
import { useLocale } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useMailValidity, useSendMail } from '@/service/use-common'

type CheckCodeFormValues = {
  code: string
}

export default function CheckCode() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const [token, setToken] = useState(() => decodeURIComponent(searchParams.get('token') as string))
  const [loading, setLoading] = useState(false)
  const locale = useLocale()
  const { mutateAsync: submitMail } = useSendMail()
  const { mutateAsync: verifyCode } = useMailValidity()
  const pageTitle = t(($) => $['checkCode.checkYourEmail'], { ns: 'login' })
  useDocumentTitle(pageTitle)

  const verify = async (code: string) => {
    if (loading) return
    try {
      setLoading(true)
      const res = await verifyCode({ email, code, token })
      if ((res as MailValidityResponse).is_valid) {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent((res as MailValidityResponse).token))
        router.push(`/signup/set-password?${params.toString()}`)
      } else {
        toast.error(t(($) => $['checkCode.invalidCode'], { ns: 'login' }))
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
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
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg">
        <span
          className="i-ri-mail-send-fill size-6 text-text-accent-light-mode-only"
          aria-hidden="true"
        />
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

      <Form<CheckCodeFormValues>
        onFormSubmit={({ code }) => {
          void verify(code)
        }}
      >
        <Field name="code">
          <FieldLabel>{t(($) => $['checkCode.verificationCode'], { ns: 'login' })}</FieldLabel>
          <Input
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            required
            pattern="[0-9]{6}"
            placeholder={
              t(($) => $['checkCode.verificationCodePlaceholder'], { ns: 'login' }) as string
            }
          />
          <FieldError match="valueMissing">
            {t(($) => $['checkCode.emptyCode'], { ns: 'login' })}
          </FieldError>
          <FieldError match="patternMismatch">
            {t(($) => $['checkCode.invalidCode'], { ns: 'login' })}
          </FieldError>
        </Field>
        <Button type="submit" loading={loading} className="my-3 w-full" variant="primary">
          {t(($) => $['checkCode.verify'], { ns: 'login' })}
        </Button>
        <Countdown onResend={resendCode} />
      </Form>
      <div className="py-2">
        <div className="h-px bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <button
        type="button"
        onClick={() => router.back()}
        className="flex h-9 cursor-pointer appearance-none items-center justify-center text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <span className="bg-background-default-dimm inline-block rounded-full p-1">
          <span className="i-ri-arrow-left-line size-3" aria-hidden="true" />
        </span>
        <span className="ml-2 system-xs-regular">{t(($) => $.back, { ns: 'login' })}</span>
      </button>
    </div>
  )
}
