'use client'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRouter } from 'next/navigation'

import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import Loading from '../components/base/loading'
import Input from '../components/base/input'
import Button from '@/app/components/base/button'

import {
  fetchInitValidateStatus,
  fetchSetupStatus,
  sendForgotPasswordEmail,
} from '@/service/common'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'

const accountFormSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'login.error.emailInValid' })
    .email('login.error.emailInValid'),
})

type AccountFormValues = z.infer<typeof accountFormSchema>

const ForgotPasswordForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isEmailSent, setIsEmailSent] = useState(false)
  const { register, trigger, getValues, formState: { errors } } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: { email: '' },
  })

  const handleSendResetPasswordEmail = async (email: string) => {
    try {
      const res = await sendForgotPasswordEmail({
        url: '/forgot-password',
        body: { email },
      })
      if (res.result === 'success')
        setIsEmailSent(true)

      else console.error('Email verification failed')
    }
    catch (error) {
      console.error('Request failed:', error)
    }
  }

  const handleSendResetPasswordClick = async () => {
    if (isEmailSent) {
      router.push('/signin')
    }
    else {
      const isValid = await trigger('email')
      if (isValid) {
        const email = getValues('email')
        await handleSendResetPasswordEmail(email)
      }
    }
  }

  useEffect(() => {
    fetchSetupStatus().then((res: SetupStatusResponse) => {
      fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
        if (res.status === 'not_started')
          window.location.href = '/init'
      })

      setLoading(false)
    })
  }, [])

  return (
    loading
      ? <Loading />
      : <>
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="text-[32px] font-bold text-gray-900">
            {isEmailSent ? t('login.resetLinkSent') : t('login.forgotPassword')}
          </h2>
          <p className='mt-1 text-sm text-gray-600'>
            {isEmailSent ? t('login.checkEmailForResetLink') : t('login.forgotPasswordDesc')}
          </p>
        </div>
        <div className="mt-8 grow sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white ">
            <form>
              {!isEmailSent && (
                <div className='mb-5'>
                  <label htmlFor="email"
                    className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                    {t('login.email')}
                  </label>
                  <div className="mt-1">
                    <Input
                      {...register('email')}
                      placeholder={t('login.emailPlaceholder') || ''}
                    />
                    {errors.email && <span className='text-sm text-red-400'>{t(`${errors.email?.message}`)}</span>}
                  </div>
                </div>
              )}
              <div>
                <Button variant='primary' className='w-full' onClick={handleSendResetPasswordClick}>
                  {isEmailSent ? t('login.backToSignIn') : t('login.sendResetLink')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </>
  )
}

export default ForgotPasswordForm
