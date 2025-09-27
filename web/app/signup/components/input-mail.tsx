'use client'
import { noop } from 'lodash-es'
import Input from '@/app/components/base/input'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useCallback, useState } from 'react'
import Button from '@/app/components/base/button'
import { emailRegex } from '@/config'
import Toast from '@/app/components/base/toast'
import type { MailSendResponse } from '@/service/use-common'
import { useSendMail } from '@/service/use-common'
import I18n from '@/context/i18n'
import Split from '@/app/signin/split'
import Link from 'next/link'
import { useGlobalPublicStore } from '@/context/global-public-context'

type Props = {
  onSuccess: (email: string, payload: string) => void
}
export default function Form({
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const { locale } = useContext(I18n)
  const { systemFeatures } = useGlobalPublicStore()

  const { mutateAsync: submitMail, isPending } = useSendMail()

  const handleSubmit = useCallback(async () => {
    if (!email) {
      Toast.notify({ type: 'error', message: t('login.error.emailEmpty') })
      return
    }
    if (!emailRegex.test(email)) {
      Toast.notify({
        type: 'error',
        message: t('login.error.emailInValid'),
      })
      return
    }
    const res = await submitMail({ email, language: locale })
    if((res as MailSendResponse).result === 'success')
      onSuccess(email, (res as MailSendResponse).data)
  }, [email, locale, submitMail, t])

  return <form onSubmit={noop}>
    <div className='mb-3'>
      <label htmlFor="email" className="system-md-semibold my-2 text-text-secondary">
        {t('login.email')}
      </label>
      <div className="mt-1">
        <Input
          value={email}
          onChange={e => setEmail(e.target.value)}
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t('login.emailPlaceholder') || ''}
          tabIndex={1}
        />
      </div>
    </div>
    <div className='mb-2'>
      <Button
        tabIndex={2}
        variant='primary'
        onClick={handleSubmit}
        disabled={isPending || !email}
        className="w-full"
      >{t('login.signup.verifyMail')}</Button>
    </div>
    <Split className='mb-5 mt-4' />

    <div className='text-[13px] font-medium leading-4 text-text-secondary'>
      <span>{t('login.signup.haveAccount')}</span>
      <Link
        className='text-text-accent'
        href='/signin'
      >{t('login.signup.signIn')}</Link>
    </div>

    {!systemFeatures.branding.enabled && <>
      <div className="system-xs-regular mt-3 block w-full text-text-tertiary">
        {t('login.tosDesc')}
              &nbsp;
        <Link
          className='system-xs-medium text-text-secondary hover:underline'
          target='_blank' rel='noopener noreferrer'
          href='https://dify.ai/terms'
        >{t('login.tos')}</Link>
              &nbsp;&&nbsp;
        <Link
          className='system-xs-medium text-text-secondary hover:underline'
          target='_blank' rel='noopener noreferrer'
          href='https://dify.ai/privacy'
        >{t('login.pp')}</Link>
      </div>
    </>}

  </form>
}
