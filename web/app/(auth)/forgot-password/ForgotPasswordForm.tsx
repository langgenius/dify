'use client'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'

type ForgotPasswordFormValues = {
  email: string
}

const emailSchema = z.email('error.emailInValid').min(1, {
  error: 'error.emailInValid',
})

const ForgotPasswordForm = () => {
  const { t } = useTranslation(['common', 'login'])
  const router = useRouter()
  const initStatus = useQuery(consoleQuery.init.get.queryOptions({ retry: false }))
  const isInitPending = initStatus.data?.status === 'not_started'
  const sendResetLink = useMutation(consoleQuery.forgotPassword.post.mutationOptions())
  const isEmailSent = sendResetLink.data?.result === 'success'
  const documentTitle = isEmailSent
    ? t(($) => $.resetLinkSent, { ns: 'login' })
    : t(($) => $.forgotPassword, { ns: 'login' })
  useDocumentTitle(documentTitle)

  const handleSubmit = ({ email }: ForgotPasswordFormValues) => {
    if (sendResetLink.isPending) return
    sendResetLink.mutate({ body: { email } })
  }

  useEffect(() => {
    if (isInitPending) router.replace('/init')
  }, [isInitPending, router])

  return (
    <>
      <div>
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
      <div className="mt-8">
        <div className="relative">
          <Form<ForgotPasswordFormValues> onFormSubmit={handleSubmit}>
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
                  placeholder={t(($) => $.emailPlaceholder, { ns: 'login' })}
                />
                <FieldError>{t(($) => $['error.emailInValid'], { ns: 'login' })}</FieldError>
              </Field>
            )}
            {isEmailSent ? (
              <Link href="/signin" className={cn(buttonVariants({ variant: 'primary' }), 'w-full')}>
                {t(($) => $.backToSignIn, { ns: 'login' })}
              </Link>
            ) : (
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                loading={sendResetLink.isPending}
              >
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
