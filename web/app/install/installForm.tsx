'use client'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import { useStore } from '@tanstack/react-form'
import Link from 'next/link'

import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import Button from '@/app/components/base/button'
import { formContext, useAppForm } from '@/app/components/base/form'
import { zodSubmitValidator } from '@/app/components/base/form/utils/zod-submit-validator'
import Input from '@/app/components/base/input'
import { validPassword } from '@/config'

import { LICENSE_LINK } from '@/constants/link'
import useDocumentTitle from '@/hooks/use-document-title'
import { fetchInitValidateStatus, fetchSetupStatus, login, setup } from '@/service/common'
import { cn } from '@/utils/classnames'
import { encryptPassword as encodePassword } from '@/utils/encryption'
import Loading from '../components/base/loading'

const accountFormSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'error.emailInValid' })
    .email('error.emailInValid'),
  name: z.string().min(1, { message: 'error.nameEmpty' }),
  password: z.string().min(8, {
    message: 'error.passwordLengthInValid',
  }).regex(validPassword, 'error.passwordInvalid'),
})

const InstallForm = () => {
  useDocumentTitle('')
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  const form = useAppForm({
    defaultValues: {
      name: '',
      password: '',
      email: '',
    },
    validators: {
      onSubmit: zodSubmitValidator(accountFormSchema),
    },
    onSubmit: async ({ value }) => {
      // First, setup the admin account
      await setup({
        body: {
          ...value,
          language: i18n.language,
        },
      })

      // Then, automatically login with the same credentials
      const loginRes = await login({
        url: '/login',
        body: {
          email: value.email,
          password: encodePassword(value.password),
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
    },
  })

  const isSubmitting = useStore(form.store, state => state.isSubmitting)
  const emailErrors = useStore(form.store, state => state.fieldMeta.email?.errors)
  const nameErrors = useStore(form.store, state => state.fieldMeta.name?.errors)
  const passwordErrors = useStore(form.store, state => state.fieldMeta.password?.errors)

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
      : (
          <>
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
              <h2 className="text-[32px] font-bold text-text-primary">{t('setAdminAccount', { ns: 'login' })}</h2>
              <p className="mt-1 text-sm text-text-secondary">{t('setAdminAccountDesc', { ns: 'login' })}</p>
            </div>
            <div className="mt-8 grow sm:mx-auto sm:w-full sm:max-w-md">
              <div className="relative">
                <formContext.Provider value={form}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (isSubmitting)
                        return
                      form.handleSubmit()
                    }}
                  >
                    <div className="mb-5">
                      <label htmlFor="email" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                        {t('email', { ns: 'login' })}
                      </label>
                      <div className="mt-1">
                        <form.AppField name="email">
                          {field => (
                            <Input
                              id="email"
                              value={field.state.value}
                              onChange={e => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder={t('emailPlaceholder', { ns: 'login' }) || ''}
                            />
                          )}
                        </form.AppField>
                        {emailErrors && emailErrors.length > 0 && (
                          <span className="text-sm text-red-400">
                            {t(`${emailErrors[0]}` as 'error.emailInValid', { ns: 'login' })}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mb-5">
                      <label htmlFor="name" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                        {t('name', { ns: 'login' })}
                      </label>
                      <div className="relative mt-1">
                        <form.AppField name="name">
                          {field => (
                            <Input
                              id="name"
                              value={field.state.value}
                              onChange={e => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder={t('namePlaceholder', { ns: 'login' }) || ''}
                            />
                          )}
                        </form.AppField>
                      </div>
                      {nameErrors && nameErrors.length > 0 && (
                        <span className="text-sm text-red-400">
                          {t(`${nameErrors[0]}` as 'error.nameEmpty', { ns: 'login' })}
                        </span>
                      )}
                    </div>

                    <div className="mb-5">
                      <label htmlFor="password" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                        {t('password', { ns: 'login' })}
                      </label>
                      <div className="relative mt-1">
                        <form.AppField name="password">
                          {field => (
                            <Input
                              id="password"
                              type={showPassword ? 'text' : 'password'}
                              value={field.state.value}
                              onChange={e => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder={t('passwordPlaceholder', { ns: 'login' }) || ''}
                            />
                          )}
                        </form.AppField>

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

                      <div className={cn('mt-1 text-xs text-text-secondary', {
                        'text-red-400 !text-sm': passwordErrors && passwordErrors.length > 0,
                      })}
                      >
                        {t('error.passwordInvalid', { ns: 'login' })}
                      </div>
                    </div>

                    <div>
                      <Button variant="primary" type="submit" disabled={isSubmitting} loading={isSubmitting} className="w-full">
                        {t('installBtn', { ns: 'login' })}
                      </Button>
                    </div>
                  </form>
                </formContext.Provider>
                <div className="mt-2 block w-full text-xs text-text-secondary">
                  {t('license.tip', { ns: 'login' })}
                &nbsp;
                  <Link
                    className="text-text-accent"
                    target="_blank"
                    rel="noopener noreferrer"
                    href={LICENSE_LINK}
                  >
                    {t('license.link', { ns: 'login' })}
                  </Link>
                </div>
              </div>
            </div>
          </>
        )
  )
}

export default InstallForm
