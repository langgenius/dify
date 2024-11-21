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

export default function CheckCode() {
  const { t } = useTranslation()
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
      else if (res.code === 'account_not_found') {
        Toast.notify({
          type: 'error',
          message: t('login.error.registrationNotAllowed'),
        })
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
    <div className='bg-background-default-dodge border border-components-panel-border-subtle shadow-lg inline-flex w-14 h-14 justify-center items-center rounded-2xl'>
      <RiLockPasswordLine className='w-6 h-6 text-2xl text-text-accent-light-mode-only' />
    </div>
    <div className='pt-2 pb-4'>
      <h2 className='title-4xl-semi-bold text-text-primary'>{t('login.resetPassword')}</h2>
      <p className='body-md-regular mt-2 text-text-secondary'>
        {t('login.resetPasswordDesc')}
      </p>
    </div>

    <form onSubmit={() => { }}>
      <input type='text' className='hidden' />
      <div className='mb-2'>
        <label htmlFor="email" className='my-2 system-md-semibold text-text-secondary'>{t('login.email')}</label>
        <div className='mt-1'>
          <Input id='email' type="email" disabled={loading} value={email} placeholder={t('login.emailPlaceholder') as string} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className='mt-3'>
          <Button loading={loading} disabled={loading} variant='primary' className='w-full' onClick={handleGetEMailVerificationCode}>{t('login.sendVerificationCode')}</Button>
        </div>
      </div>
    </form>
    <div className='py-2'>
      <div className='bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent h-px'></div>
    </div>
    <Link href={`/signin?${searchParams.toString()}`} className='flex items-center justify-center h-9 text-text-tertiary'>
      <div className='inline-block p-1 rounded-full bg-background-default-dimm'>
        <RiArrowLeftLine size={12} />
      </div>
      <span className='ml-2 system-xs-regular'>{t('login.backToLogin')}</span>
    </Link>
  </div>
}
