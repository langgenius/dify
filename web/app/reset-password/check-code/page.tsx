'use client'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import Countdown from '@/app/components/signin/countdown'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { sendResetPasswordCode, verifyResetPasswordCode } from '@/service/common'
import I18NContext from '@/context/i18n'

export default function CheckCode() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const token = decodeURIComponent(searchParams.get('token') as string)
  const [code, setVerifyCode] = useState('')
  const [loading, setIsLoading] = useState(false)
  const { locale } = useContext(I18NContext)

  const verify = async () => {
    try {
      if (!code.trim()) {
        Toast.notify({
          type: 'error',
          message: t('login.checkCode.emptyCode'),
        })
        return
      }
      if (!/\d{6}/.test(code)) {
        Toast.notify({
          type: 'error',
          message: t('login.checkCode.invalidCode'),
        })
        return
      }
      setIsLoading(true)
      const ret = await verifyResetPasswordCode({ email, code, token })
      ret.is_valid && router.push(`/reset-password/set-password?${searchParams.toString()}`)
    }
    catch (error) { console.error(error) }
    finally {
      setIsLoading(false)
    }
  }

  const resendCode = async () => {
    try {
      const res = await sendResetPasswordCode(email, locale)
      if (res.result === 'success') {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(res.data))
        router.replace(`/reset-password/check-code?${params.toString()}`)
      }
    }
    catch (error) { console.error(error) }
  }

  return <div className='flex flex-col gap-3'>
    <div className='bg-background-default-dodge text-text-accent-light-mode-only border border-components-panel-border-subtle shadow-lg inline-flex w-14 h-14 justify-center items-center rounded-2xl'>
      <RiMailSendFill className='w-6 h-6 text-2xl' />
    </div>
    <div className='pt-2 pb-4'>
      <h2 className='title-4xl-semi-bold text-text-primary'>{t('login.checkCode.checkYourEmail')}</h2>
      <p className='mt-2 body-md-regular text-text-secondary'>
        <span dangerouslySetInnerHTML={{ __html: t('login.checkCode.tips', { email }) as string }}></span>
        <br />
        {t('login.checkCode.validTime')}
      </p>
    </div>

    <form action="">
      <input type='text' className='hidden' />
      <label htmlFor="code" className='system-md-semibold text-text-secondary mb-1'>{t('login.checkCode.verificationCode')}</label>
      <Input value={code} onChange={e => setVerifyCode(e.target.value)} max-length={6} className='mt-1' placeholder={t('login.checkCode.verificationCodePlaceholder') as string} />
      <Button loading={loading} disabled={loading} className='my-3 w-full' variant='primary' onClick={verify}>{t('login.checkCode.verify')}</Button>
      <Countdown onResend={resendCode} />
    </form>
    <div className='py-2'>
      <div className='bg-gradient-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent h-px'></div>
    </div>
    <div onClick={() => router.back()} className='flex items-center justify-center h-9 text-text-tertiary cursor-pointer'>
      <div className='inline-block p-1 rounded-full bg-background-default-dimm'>
        <RiArrowLeftLine size={12} />
      </div>
      <span className='ml-2 system-xs-regular'>{t('login.back')}</span>
    </div>
  </div>
}
