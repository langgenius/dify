'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { emailRegex } from '@/config'
import { useLocale } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendResetPasswordCode } from '@/service/common'
import { COUNT_DOWN_TIME_MS, useSetCountdownLeftTime } from '../components/signin/storage'

export default function CheckCode() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const locale = useLocale()
  const setCountdownLeftTime = useSetCountdownLeftTime()
  const pageTitle = t(($) => $.resetPassword, { ns: 'login' })
  useDocumentTitle(pageTitle)

  const handleGetEMailVerificationCode = async () => {
    if (loading) return
    try {
      setLoading(true)
      const res = await sendResetPasswordCode(email, locale)
      if (res.result === 'success') {
        setCountdownLeftTime(`${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(res.data))
        params.set('email', encodeURIComponent(email))
        router.push(`/reset-password/check-code?${params.toString()}`)
      } else {
        toast.error(res.data)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg">
        <span
          className="i-ri-lock-password-line size-6 text-text-accent-light-mode-only"
          aria-hidden="true"
        />
      </div>
      <div className="pt-2 pb-4">
        <h1 className="title-4xl-semi-bold text-text-primary">{pageTitle}</h1>
        <p className="mt-2 body-md-regular text-text-secondary">
          {t(($) => $.resetPasswordDesc, { ns: 'login' })}
        </p>
      </div>

      <Form
        onFormSubmit={() => {
          void handleGetEMailVerificationCode()
        }}
      >
        <Field
          name="email"
          validate={(value) => {
            const emailValue = String(value)
            return !emailValue || emailRegex.test(emailValue)
              ? null
              : t(($) => $['error.emailInValid'], { ns: 'login' })
          }}
          className="mb-3"
        >
          <FieldLabel>{t(($) => $.email, { ns: 'login' })}</FieldLabel>
          <Input
            type="email"
            required
            autoComplete="email"
            spellCheck={false}
            value={email}
            placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) as string}
            onValueChange={setEmail}
          />
          <FieldError>
            {t(($) => $[email ? 'error.emailInValid' : 'error.emailEmpty'], { ns: 'login' })}
          </FieldError>
        </Field>
        <Button type="submit" loading={loading} variant="primary" className="w-full">
          {t(($) => $.sendVerificationCode, { ns: 'login' })}
        </Button>
      </Form>
      <div className="py-2">
        <div className="h-px bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <Link
        href={`/signin?${searchParams.toString()}`}
        className="flex h-9 items-center justify-center text-text-tertiary hover:text-text-primary"
      >
        <div className="inline-block rounded-full bg-background-default-dimmed p-1">
          <span className="i-ri-arrow-left-line size-3" aria-hidden="true" />
        </div>
        <span className="ml-2 system-xs-regular">{t(($) => $.backToLogin, { ns: 'login' })}</span>
      </Link>
    </div>
  )
}
