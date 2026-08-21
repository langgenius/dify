'use client'
import type { MailSendResponse } from '@/service/use-common'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Split from '@/app/signin/split'
import { emailRegex } from '@/config'
import { useLocale } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import Link from '@/next/link'
import { useSearchParams } from '@/next/navigation'
import { useSendMail } from '@/service/use-common'

type Props = {
  onSuccess: (email: string, payload: string) => void
}
export default function SignupEmailForm({ onSuccess }: Props) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const locale = useLocale()
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const signinHref = queryString ? `/signin?${queryString}` : '/signin'
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

  const { mutateAsync: submitMail, isPending } = useSendMail()

  const handleSubmit = useCallback(async () => {
    if (isPending) return

    if (!email) {
      toast.error(t(($) => $['error.emailEmpty'], { ns: 'login' }))
      return
    }
    if (!emailRegex.test(email)) {
      toast.error(t(($) => $['error.emailInValid'], { ns: 'login' }))
      return
    }
    const res = await submitMail({ email, language: locale })
    if ((res as MailSendResponse).result === 'success')
      onSuccess(email, (res as MailSendResponse).data)
  }, [email, locale, submitMail, t, isPending, onSuccess])

  return (
    <Form
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
    >
      <Field name="email" className="mb-3">
        <FieldLabel className="py-0 text-[14px] leading-5 font-semibold text-text-secondary">
          {t(($) => $.email, { ns: 'login' })}
        </FieldLabel>
        <Input
          value={email}
          onValueChange={setEmail}
          type="email"
          autoComplete="email"
          spellCheck={false}
          placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) || ''}
        />
      </Field>
      <div className="mb-2">
        <Button variant="primary" type="submit" disabled={isPending || !email} className="w-full">
          {t(($) => $['signup.verifyMail'], { ns: 'login' })}
        </Button>
      </div>
      <Split className="mt-4 mb-5" />

      <div className="text-[13px] leading-4 font-medium text-text-secondary">
        <span>{t(($) => $['signup.haveAccount'], { ns: 'login' })}</span>
        <Link className="text-text-accent" href={signinHref}>
          {t(($) => $['signup.signIn'], { ns: 'login' })}
        </Link>
      </div>

      {!systemFeatures.branding.enabled && (
        <>
          <div className="mt-3 block w-full system-xs-regular text-text-tertiary">
            {t(($) => $.tosDesc, { ns: 'login' })}
            &nbsp;
            <Link
              className="system-xs-medium text-text-secondary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              href="https://dify.ai/terms"
            >
              {t(($) => $.tos, { ns: 'login' })}
            </Link>
            &nbsp;&&nbsp;
            <Link
              className="system-xs-medium text-text-secondary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              href="https://dify.ai/privacy"
            >
              {t(($) => $.pp, { ns: 'login' })}
            </Link>
          </div>
        </>
      )}
    </Form>
  )
}
