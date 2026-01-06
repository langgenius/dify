'use client'
import type { InitValidateStatusResponse } from '@/models/common'
import { useStore } from '@tanstack/react-form'

import { useRouter } from 'next/navigation'

import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import Button from '@/app/components/base/button'
import { formContext, useAppForm } from '@/app/components/base/form'
import { zodSubmitValidator } from '@/app/components/base/form/utils/zod-submit-validator'
import {
  fetchInitValidateStatus,
  fetchSetupStatus,
  sendForgotPasswordEmail,
} from '@/service/common'
import { basePath } from '@/utils/var'

import Input from '../components/base/input'
import Loading from '../components/base/loading'

const accountFormSchema = z.object({
  email: z
    .string()
    .min(1, { message: 'error.emailInValid' })
    .email('error.emailInValid'),
})

const ForgotPasswordForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isEmailSent, setIsEmailSent] = useState(false)

  const form = useAppForm({
    defaultValues: { email: '' },
    validators: {
      onSubmit: zodSubmitValidator(accountFormSchema),
    },
    onSubmit: async ({ value }) => {
      try {
        const res = await sendForgotPasswordEmail({
          url: '/forgot-password',
          body: { email: value.email },
        })
        if (res.result === 'success')
          setIsEmailSent(true)
        else console.error('Email verification failed')
      }
      catch (error) {
        console.error('Request failed:', error)
      }
    },
  })

  const isSubmitting = useStore(form.store, state => state.isSubmitting)
  const emailErrors = useStore(form.store, state => state.fieldMeta.email?.errors)

  const handleSendResetPasswordClick = async () => {
    if (isSubmitting)
      return

    if (isEmailSent) {
      router.push('/signin')
    }
    else {
      form.handleSubmit()
    }
  }

  useEffect(() => {
    fetchSetupStatus().then(() => {
      fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
        if (res.status === 'not_started')
          window.location.href = `${basePath}/init`
      })

      setLoading(false)
    })
  }, [])

  return (
    loading
      ? <Loading />
      : (
          <>
            <div className="sm:mx-auto sm:w-full sm:max-w-md">
              <h2 className="text-[32px] font-bold text-text-primary">
                {isEmailSent ? t('resetLinkSent', { ns: 'login' }) : t('forgotPassword', { ns: 'login' })}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">
                {isEmailSent ? t('checkEmailForResetLink', { ns: 'login' }) : t('forgotPasswordDesc', { ns: 'login' })}
              </p>
            </div>
            <div className="mt-8 grow sm:mx-auto sm:w-full sm:max-w-md">
              <div className="relative">
                <formContext.Provider value={form}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      form.handleSubmit()
                    }}
                  >
                    {!isEmailSent && (
                      <div className="mb-5">
                        <label
                          htmlFor="email"
                          className="my-2 flex items-center justify-between text-sm font-medium text-text-primary"
                        >
                          {t('email', { ns: 'login' })}
                        </label>
                        <div className="mt-1">
                          <form.AppField
                            name="email"
                          >
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
                    )}
                    <div>
                      <Button variant="primary" className="w-full" disabled={isSubmitting} onClick={handleSendResetPasswordClick}>
                        {isEmailSent ? t('backToSignIn', { ns: 'login' }) : t('sendResetLink', { ns: 'login' })}
                      </Button>
                    </div>
                  </form>
                </formContext.Provider>
              </div>
            </div>
          </>
        )
  )
}

export default ForgotPasswordForm
