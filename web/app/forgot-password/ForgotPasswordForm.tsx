'use client'
import type { InitValidateStatusResponse } from '@/models/common'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import {
  fetchInitValidateStatus,
  fetchSetupStatus,
  sendForgotPasswordEmail,
} from '@/service/common'
import { basePath } from '@/utils/var'
import Loading from '../components/base/loading'

type ForgotPasswordFormValues = {
  email: string
}

const emailSchema = z.email('error.emailInValid').min(1, {
  error: 'error.emailInValid',
})

const ForgotPasswordForm = () => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEmailSent, setIsEmailSent] = useState(false)
  const documentTitle = loading
    ? t(($) => $.loading, { ns: 'common' })
    : isEmailSent
      ? t(($) => $.resetLinkSent, { ns: 'login' })
      : t(($) => $.forgotPassword, { ns: 'login' })
  useDocumentTitle(documentTitle)

  const handleSubmit = async ({ email }: ForgotPasswordFormValues) => {
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      const res = await sendForgotPasswordEmail({
        url: '/forgot-password',
        body: { email },
      })
      if (res.result === 'success') setIsEmailSent(true)
      else console.error('Email verification failed')
    } catch (error) {
      console.error('Request failed:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    fetchSetupStatus().then(() => {
      fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
        if (res.status === 'not_started') window.location.href = `${basePath}/init`
      })

      setLoading(false)
    })
  }, [])

  return loading ? (
    <Loading />
  ) : (
    <>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-[32px] font-bold text-text-primary">
          {isEmailSent
            ? t(($) => $.resetLinkSent, { ns: 'login' })
            : t(($) => $.forgotPassword, { ns: 'login' })}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {isEmailSent
            ? t(($) => $.checkEmailForResetLink, { ns: 'login' })
            : t(($) => $.forgotPasswordDesc, { ns: 'login' })}
        </p>
      </div>
      <div className="mt-8 grow sm:mx-auto sm:w-full sm:max-w-md">
        <div className="relative">
          <Form<ForgotPasswordFormValues>
            onFormSubmit={(value) => {
              void handleSubmit(value)
            }}
          >
            {!isEmailSent && (
              <Field
                name="email"
                validate={(value) =>
                  emailSchema.safeParse(value).success
                    ? null
                    : t(($) => $['error.emailInValid'], { ns: 'login' })
                }
                className="mb-5"
              >
                <FieldLabel>{t(($) => $.email, { ns: 'login' })}</FieldLabel>
                <Input
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  required
                  placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) || ''}
                />
                <FieldError>{t(($) => $['error.emailInValid'], { ns: 'login' })}</FieldError>
              </Field>
            )}
            {isEmailSent ? (
              <Link href="/signin" className={cn(buttonVariants({ variant: 'primary' }), 'w-full')}>
                {t(($) => $.backToSignIn, { ns: 'login' })}
              </Link>
            ) : (
              <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>
                {t(($) => $.sendResetLink, { ns: 'login' })}
              </Button>
            )}
          </Form>
        </div>
      </div>
    </>
  )
}

export default ForgotPasswordForm
