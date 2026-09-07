'use client'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import { zPostSetupBody } from '@dify/contracts/api/console/setup/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldValidity,
} from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'
import { validPassword } from '@/config'
import { LICENSE_LINK } from '@/constants/link'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { fetchInitValidateStatus, fetchSetupStatus, login, setup } from '@/service/common'
import { encryptPassword as encodePassword } from '@/utils/encryption'
import Loading from '../components/base/loading'

const accountFormSchema = zPostSetupBody.pick({ email: true, name: true, password: true }).extend({
  email: zPostSetupBody.shape.email.pipe(z.email()),
  name: zPostSetupBody.shape.name.min(1),
  password: zPostSetupBody.shape.password.min(8).regex(validPassword),
})

type AccountFormValues = z.infer<typeof accountFormSchema>

const InstallForm = () => {
  const { t, i18n } = useTranslation()
  const pageTitle = t(($) => $.setAdminAccount, { ns: 'login' })
  useDocumentTitle(pageTitle)
  const { push, replace } = useRouter()
  const queryClient = useQueryClient()
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleSubmit = async (value: AccountFormValues) => {
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
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
    } finally {
      setIsSubmitting(false)
    }
  }

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
          <Form<AccountFormValues> onFormSubmit={(value) => void handleSubmit(value)}>
            <Field
              name="email"
              validate={(value) =>
                accountFormSchema.shape.email.safeParse(value).success
                  ? null
                  : t(($) => $['error.emailInValid'], { ns: 'login' })
              }
              className="mb-5"
            >
              <FieldLabel>{t(($) => $.email, { ns: 'login' })}</FieldLabel>
              <Input
                type="email"
                autoComplete="email"
                spellCheck={false}
                required
                placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) || ''}
              />
              <FieldError>{t(($) => $['error.emailInValid'], { ns: 'login' })}</FieldError>
            </Field>

            <Field
              name="name"
              validate={(value) =>
                accountFormSchema.shape.name.safeParse(value).success
                  ? null
                  : t(($) => $['error.nameEmpty'], { ns: 'login' })
              }
              className="mb-5"
            >
              <FieldLabel>{t(($) => $.name, { ns: 'login' })}</FieldLabel>
              <Input
                autoComplete="name"
                required
                maxLength={30}
                placeholder={t(($) => $.namePlaceholder, { ns: 'login' }) || ''}
              />
              <FieldError>{t(($) => $['error.nameEmpty'], { ns: 'login' })}</FieldError>
            </Field>

            <Field
              name="password"
              validate={(value) =>
                accountFormSchema.shape.password.safeParse(value).success
                  ? null
                  : t(($) => $['error.passwordInvalid'], { ns: 'login' })
              }
              className="mb-5"
            >
              <FieldLabel>{t(($) => $.password, { ns: 'login' })}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  spellCheck={false}
                  required
                  minLength={8}
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
                      className={showPassword ? 'i-ri-eye-off-line size-4' : 'i-ri-eye-line size-4'}
                    />
                  </IconButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldValidity>
                {({ validity }) =>
                  validity.valid === false ? null : (
                    <FieldDescription className="text-text-secondary">
                      {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
                    </FieldDescription>
                  )
                }
              </FieldValidity>
              <FieldError>{t(($) => $['error.passwordInvalid'], { ns: 'login' })}</FieldError>
            </Field>

            <div>
              <Button variant="primary" type="submit" loading={isSubmitting} className="w-full">
                {t(($) => $.installBtn, { ns: 'login' })}
              </Button>
            </div>
          </Form>
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
