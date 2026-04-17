'use client'
import type { MailSendResponse } from '@/service/use-common'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { Button } from '@/app/components/base/ui/button'
import { toast } from '@/app/components/base/ui/toast'
import Split from '@/app/signin/split'
import { emailRegex } from '@/config'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useLocale } from '@/context/i18n'
import Link from '@/next/link'
import { useSendMail } from '@/service/use-common'

type Props = {
  onSuccess: (email: string, payload: string) => void
}
export default function Form({
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const locale = useLocale()
  const { systemFeatures } = useGlobalPublicStore()

  const { mutateAsync: submitMail, isPending } = useSendMail()

  const handleSubmit = useCallback(async () => {
    if (isPending)
      return

    if (!email) {
      toast.error(t('error.emailEmpty', { ns: 'login' }))
      return
    }
    if (!emailRegex.test(email)) {
      toast.error(t('error.emailInValid', { ns: 'login' }))
      return
    }
    const res = await submitMail({ email, language: locale })
    if ((res as MailSendResponse).result === 'success')
      onSuccess(email, (res as MailSendResponse).data)
  }, [email, locale, submitMail, t, isPending, onSuccess])

  return (
    <form onSubmit={(e) => {
      e.preventDefault()
      handleSubmit()
    }}
    >
      <div className="mb-3">
        <label htmlFor="email" className="my-2 system-md-semibold text-text-secondary">
          {t('email', { ns: 'login' })}
        </label>
        <div className="mt-1">
          <Input
            value={email}
            onChange={e => setEmail(e.target.value)}
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t('emailPlaceholder', { ns: 'login' }) || ''}
            tabIndex={1}
          />
        </div>
      </div>
      <div className="mb-2">
        <Button
          tabIndex={2}
          variant="primary"
          type="submit"
          disabled={isPending || !email}
          className="w-full"
        >
          {t('signup.verifyMail', { ns: 'login' })}
        </Button>
      </div>
      <Split className="mt-4 mb-5" />

      <div className="text-[13px] leading-4 font-medium text-text-secondary">
        <span>{t('signup.haveAccount', { ns: 'login' })}</span>
        <Link
          className="text-text-accent"
          href="/signin"
        >
          {t('signup.signIn', { ns: 'login' })}
        </Link>
      </div>

      {!systemFeatures.branding.enabled && (
        <>
          <div className="mt-3 block w-full system-xs-regular text-text-tertiary">
            {t('tosDesc', { ns: 'login' })}
            &nbsp;
            <Link
              className="system-xs-medium text-text-secondary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              href="https://dify.ai/terms"
            >
              {t('tos', { ns: 'login' })}
            </Link>
            &nbsp;&&nbsp;
            <Link
              className="system-xs-medium text-text-secondary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              href="https://dify.ai/privacy"
            >
              {t('pp', { ns: 'login' })}
            </Link>
          </div>
        </>
      )}

    </form>
  )
}
