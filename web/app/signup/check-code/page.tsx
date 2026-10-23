'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import Countdown from '@/app/components/signin/countdown'
import { toast } from '@/app/notifications'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type CheckCodeFormValues = {
  code: string
}

export default function CheckCode() {
  const { t } = useTranslation(['login'])
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const [token, setToken] = useState(() => decodeURIComponent(searchParams.get('token') as string))
  const [loading, setLoading] = useState(false)
  const locale = useLocale()
  const { mutateAsync: submitMail } = useMutation(
    consoleQuery.emailRegister.sendEmail.post.mutationOptions(),
  )
  const { mutateAsync: verifyCode } = useMutation(
    consoleQuery.emailRegister.validity.post.mutationOptions(),
  )
  const pageTitle = t(($) => $['checkCode.checkYourEmail'], { ns: 'login' })
  useDocumentTitle(pageTitle)

  const verify = async (code: string) => {
    if (loading) return
    try {
      setLoading(true)
      const res = await verifyCode({ body: { email, code, token } })
      if (res.is_valid) {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(res.token))
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
      const res = await submitMail({ body: { email, language: locale } })
      if (res.result === 'success') {
        const params = new URLSearchParams(searchParams)
        const newToken = res.data
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
        <span className="inline-block rounded-full p-1">
          <span className="i-ri-arrow-left-line size-3" aria-hidden="true" />
        </span>
        <span className="ml-2 system-xs-regular">{t(($) => $.back, { ns: 'login' })}</span>
      </button>
    </div>
  )
}
