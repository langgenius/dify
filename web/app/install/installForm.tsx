'use client'
import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { SubmitHandler } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import classNames from 'classnames'
import Loading from '../components/base/loading'
import Button from '@/app/components/base/button'

import { fetchInitValidateStatus, fetchSetupStatus, setup } from '@/service/common'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'

const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

const accountFormSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'login.error.emailInValid' })
    .email('login.error.emailInValid'),
  name: z.string().min(1, { message: 'login.error.nameEmpty' }),
  password: z.string().min(8, {
    message: 'login.error.passwordLengthInValid',
  }).regex(validPassword, 'login.error.passwordInvalid'),
})

type AccountFormValues = z.infer<typeof accountFormSchema>

const InstallForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: '',
      password: '',
      email: '',
    },
  })

  const onSubmit: SubmitHandler<AccountFormValues> = async (data) => {
    await setup({
      body: {
        ...data,
      },
    })
    router.push('/signin')
  }

  const handleSetting = async () => {
    handleSubmit(onSubmit)()
  }

  useEffect(() => {
    fetchSetupStatus().then((res: SetupStatusResponse) => {
      if (res.step === 'finished') {
        window.location.href = '/signin'
      }
      else {
        fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
          if (res.status === 'not_started')
            window.location.href = '/init'
        })
      }
      setLoading(false)
    })
  }, [])

  return (
    loading
      ? <Loading />
      : <>
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="text-[32px] font-bold text-gray-900">{t('login.setAdminAccount')}</h2>
          <p className='
          mt-1 text-sm text-gray-600
        '>{t('login.setAdminAccountDesc')}</p>
        </div>
        <div className="grow mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white ">
            <form onSubmit={handleSubmit(onSubmit)}>
              <div className='mb-5'>
                <label htmlFor="email" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.email')}
                </label>
                <div className="mt-1">
                  <input
                    {...register('email')}
                    placeholder={t('login.emailPlaceholder') || ''}
                    className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm'}
                  />
                  {errors.email && <span className='text-red-400 text-sm'>{t(`${errors.email?.message}`)}</span>}
                </div>

              </div>

              <div className='mb-5'>
                <label htmlFor="name" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.name')}
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    {...register('name')}
                    placeholder={t('login.namePlaceholder') || ''}
                    className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm pr-10'}
                  />
                </div>
                {errors.name && <span className='text-red-400 text-sm'>{t(`${errors.name.message}`)}</span>}
              </div>

              <div className='mb-5'>
                <label htmlFor="password" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('login.password')}
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('login.passwordPlaceholder') || ''}
                    className={'appearance-none block w-full rounded-lg pl-[14px] px-3 py-2 border border-gray-200 hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 placeholder-gray-400 caret-primary-600 sm:text-sm pr-10'}
                  />

                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-gray-400 hover:text-gray-500 focus:outline-none focus:text-gray-500"
                    >
                      {showPassword ? '👀' : '😝'}
                    </button>
                  </div>
                </div>

                <div className={classNames('mt-1 text-xs text-gray-500', {
                  'text-red-400 !text-sm': errors.password,
                })}>{t('login.error.passwordInvalid')}</div>
              </div>

              <div>
                <Button type='primary' className='w-full !fone-medium !text-sm' onClick={handleSetting}>
                  {t('login.installBtn')}
                </Button>
              </div>
            </form>
            <div className="block w-hull mt-2 text-xs text-gray-600">
              {t('login.license.tip')}
              &nbsp;
              <Link
                className='text-primary-600'
                target='_blank' rel='noopener noreferrer'
                href={'https://docs.dify.ai/user-agreement/open-source'}
              >{t('login.license.link')}</Link>
            </div>
          </div>
        </div>
      </>
  )
}

export default InstallForm
