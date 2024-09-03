'use client'
import Link from 'next/link'
import { RiArrowLeftLine, RiLockPasswordLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { emailRegex } from '@/config'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { sendResetPasswordCode } from '@/service/common'

export default function CheckCode() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setIsLoading] = useState(false)

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
      const res = await sendResetPasswordCode(email)
      if (res.result === 'success') {
        localStorage.setItem('leftTime', '59000')
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(res.data))
        params.set('email', encodeURIComponent(email))
        router.push(`/reset-password/check-code?${params.toString()}`)
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
    <div className='bg-background-default-dodge text-text-accent-light-mode-only border-[0.5px] shadow inline-flex  w-14 h-14 justify-center items-center rounded-2xl text-2xl'>
      <RiLockPasswordLine />
    </div>
    <div className='pt-3 pb-4'>
      <h2 className='text-4xl font-semibold'>{t('login.resetPassword')}</h2>
      <p className='text-text-secondary text-sm mt-2 leading-5'>
        {t('login.resetPasswordDesc')}
      </p>
    </div>

    <form onSubmit={() => { }}>
      <div className='mb-2'>
        <label htmlFor="email" className='my-2 block text-sm font-medium text-text-secondary'>{t('login.email')}</label>
        <div className='mt-1'>
          <Input id='email' type="email" disabled={loading} value={email} placeholder={t('login.emailPlaceholder') as string} onChange={e => setEmail(e.target.value)} className="px-3 h-9" />
        </div>
        <div className='mt-3'>
          <Button loading={loading} disabled={loading} variant='primary' className='w-full' onClick={handleGetEMailVerificationCode}>{t('login.continueWithCode')}</Button>
        </div>
      </div>
    </form>
    <div className='py-2'>
      <div className='bg-gradient-to-r from-white/[0.01] via-[#101828]/8 to-white/[0.01] h-px'></div>
    </div>
    <Link href='/signin' className='flex items-center justify-center text-xs h-9 text-text-tertiary'>
      <div className='inline-block p-1 rounded-full bg-background-default-dimm'>
        <RiArrowLeftLine size={12} />
      </div>
      <span className='ml-2'>{t('login.backToLogin')}</span>
    </Link>
  </div>
}
