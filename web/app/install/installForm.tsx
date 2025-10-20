'use client'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { SubmitHandler } from 'react-hook-form'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import Loading from '../components/base/loading'
import classNames from '@/utils/classnames'
import Button from '@/app/components/base/button'

import { fetchInitValidateStatus, fetchSetupStatus, login, setup } from '@/service/common'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import useDocumentTitle from '@/hooks/use-document-title'
import { useDocLink } from '@/context/i18n'
import { validPassword } from '@/config'

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
  useDocumentTitle('')
  const { t, i18n } = useTranslation()
  const docLink = useDocLink()
  const router = useRouter()
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: '',
      password: '',
      email: '',
    },
  })

  const onSubmit: SubmitHandler<AccountFormValues> = async (data) => {
    // First, setup the admin account
    await setup({
      body: {
        ...data,
        language: i18n.language,
      },
    })

    // Then, automatically login with the same credentials
    const loginRes = await login({
      url: '/login',
      body: {
        email: data.email,
        password: data.password,
      },
    })

    // Store tokens and redirect to apps if login successful
    if (loginRes.result === 'success') {
      router.replace('/apps')
    }
    else {
      // Fallback to signin page if auto-login fails
      router.replace('/signin')
    }
  }

  const handleSetting = async () => {
    if (isSubmitting) return
    handleSubmit(onSubmit)()
  }

  const { run: debouncedHandleKeyDown } = useDebounceFn(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSetting()
      }
    },
    { wait: 200 },
  )

  const handleKeyDown = useCallback(debouncedHandleKeyDown, [debouncedHandleKeyDown])

  useEffect(() => {
    fetchSetupStatus().then((res: SetupStatusResponse) => {
      if (res.step === 'finished') {
        localStorage.setItem('setup_status', 'finished')
        router.push('/signin')
      }
      else {
        fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
          if (res.status === 'not_started')
            router.push('/init')
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
          <h2 className="text-[32px] font-bold text-text-primary">{t('login.setAdminAccount')}</h2>
          <p className='mt-1 text-sm text-text-secondary'>{t('login.setAdminAccountDesc')}</p>
        </div>
        <div className="mt-8 grow sm:mx-auto sm:w-full sm:max-w-md">
          <div className="relative">
            <form onSubmit={handleSubmit(onSubmit)} onKeyDown={handleKeyDown}>
              <div className='mb-5'>
                <label htmlFor="email" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                  {t('login.email')}
                </label>
                <div className="mt-1 rounded-md shadow-sm">
                  <input
                    {...register('email')}
                    placeholder={t('login.emailPlaceholder') || ''}
                    className={'system-sm-regular w-full appearance-none rounded-md border border-transparent bg-components-input-bg-normal px-3 py-[7px] text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'}
                  />
                  {errors.email && <span className='text-sm text-red-400'>{t(`${errors.email?.message}`)}</span>}
                </div>

              </div>

              <div className='mb-5'>
                <label htmlFor="name" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                  {t('login.name')}
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <input
                    {...register('name')}
                    placeholder={t('login.namePlaceholder') || ''}
                    className={'system-sm-regular w-full appearance-none rounded-md border border-transparent bg-components-input-bg-normal px-3 py-[7px] text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'}
                  />
                </div>
                {errors.name && <span className='text-sm text-red-400'>{t(`${errors.name.message}`)}</span>}
              </div>

              <div className='mb-5'>
                <label htmlFor="password" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                  {t('login.password')}
                </label>
                <div className="relative mt-1 rounded-md shadow-sm">
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('login.passwordPlaceholder') || ''}
                    className={'system-sm-regular w-full appearance-none rounded-md border border-transparent bg-components-input-bg-normal px-3 py-[7px] text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'}
                  />

                  <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-text-quaternary hover:text-text-tertiary focus:text-text-tertiary focus:outline-none"
                    >
                      {showPassword ? '👀' : '😝'}
                    </button>
                  </div>
                </div>

                <div className={classNames('mt-1 text-xs text-text-secondary', {
                  'text-red-400 !text-sm': errors.password,
                })}>{t('login.error.passwordInvalid')}</div>
              </div>

              <div>
                <Button variant='primary' className='w-full' onClick={handleSetting}>
                  {t('login.installBtn')}
                </Button>
              </div>
            </form>
            <div className="mt-2 block w-full text-xs text-text-secondary">
              {t('login.license.tip')}
              &nbsp;
              <Link
                className='text-text-accent'
                target='_blank' rel='noopener noreferrer'
                href={docLink('/policies/open-source')}
              >{t('login.license.link')}</Link>
            </div>
          </div>
        </div>
      </>
  )
}

export default InstallForm
