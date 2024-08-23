'use client'
import Link from 'next/link'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import Countdown from './countdown'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'

export default function CheckCode() {
  const { t } = useTranslation()
  const [code, setVerifyCode] = useState('')

  const verify = async () => {
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
    }
  }

  return <div className='flex flex-col gap-3'>
    <div className='bg-background-default-dodge text-text-accent-light-mode-only border-[0.5px] shadow inline-flex  w-14 h-14 justify-center items-center rounded-2xl text-2xl'>
      <RiMailSendFill />
    </div>
    <div className='pt-3 pb-4'>
      <h2 className='text-4xl font-semibold'>{t('login.checkCode.checkYourEmail')}</h2>
      <p className='text-text-secondary text-sm mt-2 leading-5'>
        <span dangerouslySetInnerHTML={{ __html: t('login.checkCode.tips', { email: 'evan@dify.ai' }) as string }}></span>
        <br />
        {t('login.checkCode.validTime')}
      </p>
    </div>

    <form action="">
      <label htmlFor="code" className='text-text-secondary text-sm font-semibold mb-1'>{t('login.checkCode.verificationCode')}</label>
      <Input value={code} onChange={setVerifyCode} max-length={6} className='px-3 mt-1 leading-5 h-9 appearance-none' placeholder={t('login.checkCode.verificationCodePlaceholder') as string} />
      <Button className='my-3 w-full' variant='primary' onClick={verify}>{t('login.checkCode.verify')}</Button>
      <Countdown />
    </form>
    <div className='py-2'>
      <div className='bg-gradient-to-r from-white/[0.01] via-[#101828]/8 to-white/[0.01] h-px'></div>
    </div>
    <Link href='/signin' className='flex items-center justify-center text-xs h-9 text-text-tertiary'>
      <div className='inline-block p-1 rounded-full bg-background-default-dimm'>
        <RiArrowLeftLine size={12} />
      </div>
      <span className='ml-2'>{t('login.checkCode.useAnotherMethod')}</span>
    </Link>
  </div>
}
