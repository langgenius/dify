'use client'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useStore } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'
import { formContext as FormContext, useAppForm } from '@/app/components/base/form'
import { zodSubmitValidator } from '@/app/components/base/form/utils/zod-submit-validator'
import { validPassword } from '@/config'
import { LICENSE_LINK } from '@/constants/link'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { fetchInitValidateStatus, fetchSetupStatus, login, setup } from '@/service/common'
import { encryptPassword as encodePassword } from '@/utils/encryption'
import Loading from '../components/base/loading'

const accountFormSchema = z.object({
  email: z.email('error.emailInValid').min(1, {
    error: 'error.emailInValid',
  }),
  name: z.string().min(1, {
    error: 'error.nameEmpty',
  }),
  password: z
    .string()
    .min(8, {
      error: 'error.passwordLengthInValid',
    })
    .regex(validPassword, 'error.passwordInvalid'),
})

const InstallForm = () => {
  const { t, i18n } = useTranslation()
  const pageTitle = t(($) => $.setAdminAccount, { ns: 'login' })
  useDocumentTitle(pageTitle)
  const { push, replace } = useRouter()
  const queryClient = useQueryClient()
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

      // Store tokens and redirect if login successful
      if (loginRes.result === 'success') {
        await queryClient.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })
        replace('/')
      } else {
        // Fallback to signin page if auto-login fails
        replace('/signin')
      }
    },
  })

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)
  const emailErrors = useStore(form.store, (state) => state.fieldMeta.email?.errors)
  const nameErrors = useStore(form.store, (state) => state.fieldMeta.name?.errors)
  const passwordErrors = useStore(form.store, (state) => state.fieldMeta.password?.errors)

  useEffect(() => {
    fetchSetupStatus().then((res: SetupStatusResponse) => {
      if (res.step === 'finished') {
        push('/signin')
      } else {
        fetchInitValidateStatus().then((res: InitValidateStatusResponse) => {
          if (res.status === 'not_started') push('/init')
        })
      }
      setLoading(false)
    })
  }, [push])

  return loading ? (
    <Loading />
  ) : (
    <>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-[32px] font-bold text-text-primary">{pageTitle}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t(($) => $.setAdminAccountDesc, { ns: 'login' })}
        </p>
      </div>
      <div className="mt-8 grow sm:mx-auto sm:w-full sm:max-w-md">
        <div className="relative">
          <FormContext value={form}>
            <Form
              onSubmit={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (isSubmitting) return
                form.handleSubmit()
              }}
            >
              <Field name="email" invalid={Boolean(emailErrors?.length)} className="mb-5">
                <FieldLabel>{t(($) => $.email, { ns: 'login' })}</FieldLabel>
                <form.AppField name="email">
                  {(field) => (
                    <Input
                      type="email"
                      autoComplete="email"
                      spellCheck={false}
                      value={field.state.value}
                      onValueChange={field.handleChange}
                      onBlur={field.handleBlur}
                      placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) || ''}
                    />
                  )}
                </form.AppField>
                {emailErrors && emailErrors.length > 0 && (
                  <FieldError match>
                    {t(($) => $[`${emailErrors[0]}` as 'error.emailInValid'], { ns: 'login' })}
                  </FieldError>
                )}
              </Field>

              <Field name="name" invalid={Boolean(nameErrors?.length)} className="mb-5">
                <FieldLabel>{t(($) => $.name, { ns: 'login' })}</FieldLabel>
                <form.AppField name="name">
                  {(field) => (
                    <Input
                      autoComplete="name"
                      value={field.state.value}
                      onValueChange={field.handleChange}
                      onBlur={field.handleBlur}
                      placeholder={t(($) => $.namePlaceholder, { ns: 'login' }) || ''}
                    />
                  )}
                </form.AppField>
                {nameErrors && nameErrors.length > 0 && (
                  <FieldError match>
                    {t(($) => $[`${nameErrors[0]}` as 'error.nameEmpty'], { ns: 'login' })}
                  </FieldError>
                )}
              </Field>

              <Field name="password" invalid={Boolean(passwordErrors?.length)} className="mb-5">
                <FieldLabel>{t(($) => $.password, { ns: 'login' })}</FieldLabel>
                <form.AppField name="password">
                  {(field) => (
                    <InputGroup>
                      <InputGroupInput
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        spellCheck={false}
                        value={field.state.value}
                        onValueChange={field.handleChange}
                        onBlur={field.handleBlur}
                        placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
                      />
                      <InputGroupAddon align="inline-end">
                        <IconButton
                          aria-label={t(($) => $[showPassword ? 'hidePassword' : 'showPassword'], {
                            ns: 'login',
                          })}
                          onClick={() => setShowPassword((visible) => !visible)}
                        >
                          <span
                            aria-hidden="true"
                            className={
                              showPassword ? 'i-ri-eye-off-line size-4' : 'i-ri-eye-line size-4'
                            }
                          />
                        </IconButton>
                      </InputGroupAddon>
                    </InputGroup>
                  )}
                </form.AppField>
                {passwordErrors && passwordErrors.length > 0 ? (
                  <FieldError match>
                    {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
                  </FieldError>
                ) : (
                  <FieldDescription className="text-text-secondary">
                    {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
                  </FieldDescription>
                )}
              </Field>

              <div>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  className="w-full"
                >
                  {t(($) => $.installBtn, { ns: 'login' })}
                </Button>
              </div>
            </Form>
          </FormContext>
          <div className="mt-2 block w-full text-xs text-text-secondary">
            {t(($) => $['license.tip'], { ns: 'login' })}
            &nbsp;
            <Link
              className="text-text-accent"
              target="_blank"
              rel="noopener noreferrer"
              href={LICENSE_LINK}
            >
              {t(($) => $['license.link'], { ns: 'login' })}
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

export default InstallForm
