'use client'
import Link from 'next/link'
import { RiArrowLeftLine, RiLockPasswordLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { COUNT_DOWN_KEY, COUNT_DOWN_TIME_MS } from '../components/signin/countdown'
import { emailRegex } from '@/config'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { sendResetPasswordCode } from '@/service/common'
import I18NContext from '@/context/i18n'
import { noop } from 'lodash-es'
import useDocumentTitle from '@/hooks/use-document-title'

export default function CheckCode() {
  const { t } = useTranslation()
  useDocumentTitle('')
  const searchParams = useSearchParams()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setIsLoading] = useState(false)
  const { locale } = useContext(I18NContext)

  const handleGetEMailVerificationCode = async () => {
    try {
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
      setIsLoading(true)
      const res = await sendResetPasswordCode(email, locale)
      if (res.result === 'success') {
        localStorage.setItem(COUNT_DOWN_KEY, `${COUNT_DOWN_TIME_MS}`)
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(res.data))
        params.set('email', encodeURIComponent(email))
        router.push(`/reset-password/check-code?${params.toString()}`)
      }
      else {
        Toast.notify({
          type: 'error',
          message: res.data,
        })
      }
    }
    catch (error) {
      console.error(error)
    }
    finally {
      setIsLoading(false)
    }
  }

  return <div className='flex flex-col gap-3'>
    <div className='inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg'>
      <RiLockPasswordLine className='h-6 w-6 text-2xl text-text-accent-light-mode-only' />
    </div>
    <div className='pb-4 pt-2'>
      <h2 className='title-4xl-semi-bold text-text-primary'>{t('login.resetPassword')}</h2>
      <p className='body-md-regular mt-2 text-text-secondary'>
        {t('login.resetPasswordDesc')}
      </p>
    </div>

    <form onSubmit={noop}>
      <input type='text' className='hidden' />
      <div className='mb-2'>
        <label htmlFor="email" className='system-md-semibold my-2 text-text-secondary'>{t('login.email')}</label>
        <div className='mt-1'>
          <Input id='email' type="email" disabled={loading} value={email} placeholder={t('login.emailPlaceholder') as string} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className='mt-3'>
          <Button loading={loading} disabled={loading} variant='primary' className='w-full' onClick={handleGetEMailVerificationCode}>{t('login.sendVerificationCode')}</Button>
        </div>
      </div>
    </form>
    <div className='py-2'>
      <div className='h-px bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent'></div>
    </div>
    <Link href={`/signin?${searchParams.toString()}`} className='flex h-9 items-center justify-center text-text-tertiary hover:text-text-primary'>
      <div className='inline-block rounded-full bg-background-default-dimmed p-1'>
        <RiArrowLeftLine size={12} />
      </div>
      <span className='system-xs-regular ml-2'>{t('login.backToLogin')}</span>
    </Link>
  </div>
}
