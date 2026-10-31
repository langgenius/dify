'use client'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { consoleClient } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'
import { basePath } from '@/utils/var'

type ForgotPasswordFormValues = {
  email: string
}

const emailSchema = z.email('error.emailInValid').min(1, {
  error: 'error.emailInValid',
})

const ForgotPasswordForm = () => {
  const [requestError, setRequestError] = useState<unknown>()
  const { t: tRequestError } = useTranslation(['common'])

  const { t } = useTranslation(['common', 'login'])
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
    setRequestError(undefined)
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      const res = await consoleClient.forgotPassword.post({ body: { email } })
      if (res.result === 'success') setIsEmailSent(true)
      else console.error('Email verification failed')
    } catch (error) {
      setRequestError(error)
      console.error('Request failed:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await consoleClient.setup.get()
        const res = await consoleClient.init.get()
        if (res.status === 'not_started') window.location.href = `${basePath}/init`
      } catch (error) {
        setRequestError(error)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return loading ? (
    <LoadingPlaceholder />
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
            {!!requestError && (
              <p role="alert" className="mb-3 system-sm-regular text-text-destructive">
                {getErrorMessage(requestError) ?? tRequestError(($) => $['api.actionFailed'])}
              </p>
            )}
            {!isEmailSent && (
              <Field
                name="email"
                validate={(value) =>
                  emailSchema.validate(value)
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
