'use client'
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
import { Input } from '@langgenius/dify-ui/input'
import {
  PasswordField,
  PasswordFieldInput,
  PasswordFieldToggle,
} from '@langgenius/dify-ui/password-field'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'
import { validPassword } from '@/config'
import { LICENSE_LINK } from '@/constants/link'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/console'
import { encryptPassword as encodePassword } from '@/utils/encryption'

const accountFormSchema = zPostSetupBody.pick({ email: true, name: true, password: true }).extend({
  email: zPostSetupBody.shape.email.pipe(z.email()),
  name: zPostSetupBody.shape.name.min(1),
  password: zPostSetupBody.shape.password.min(8).regex(validPassword),
})

type AccountFormValues = z.infer<typeof accountFormSchema>

const InstallForm = () => {
  const { t, i18n } = useTranslation(['login'])
  const pageTitle = t(($) => $.setAdminAccount, { ns: 'login' })
  useDocumentTitle(pageTitle)
  const { replace } = useRouter()
  const queryClient = useQueryClient()
  const initStatus = useQuery(
    consoleQuery.init.get.queryOptions({ retry: false, throwOnError: true }),
  )
  const isInitPending = initStatus.data?.status === 'not_started'
  const setupAccount = useMutation({
    mutationFn: async (value: AccountFormValues) => {
      await consoleClient.setup.post({
        body: {
          ...value,
          language: i18n.language,
        },
      })

      return consoleClient.login.post({
        body: {
          email: value.email,
          password: encodePassword(value.password),
        },
      })
    },
    onSuccess: async (loginRes) => {
      if (loginRes.result === 'success') {
        await queryClient.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })
        replace('/')
      } else {
        replace('/signin')
      }
    },
  })
  const isSubmitting = setupAccount.isPending || setupAccount.isSuccess

  const handleSubmit = (value: AccountFormValues) => {
    if (isSubmitting) return
    setupAccount.mutate(value)
  }

  useEffect(() => {
    if (isInitPending) replace('/init')
  }, [isInitPending, replace])

  return (
    <>
      <div>
        <h1 className="text-[32px] font-bold text-text-primary">{pageTitle}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {t(($) => $.setAdminAccountDesc, { ns: 'login' })}
        </p>
      </div>
      <div className="mt-8">
        <div className="relative">
          <Form<AccountFormValues> onFormSubmit={handleSubmit}>
            <Field
              name="email"
              validate={(value) =>
                accountFormSchema.shape.email.validate(value)
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
                placeholder={t(($) => $.emailPlaceholder, { ns: 'login' })}
              />
              <FieldError>{t(($) => $['error.emailInValid'], { ns: 'login' })}</FieldError>
            </Field>

            <Field
              name="name"
              validate={(value) =>
                accountFormSchema.shape.name.validate(value)
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
                placeholder={t(($) => $.namePlaceholder, { ns: 'login' })}
              />
              <FieldError>{t(($) => $['error.nameEmpty'], { ns: 'login' })}</FieldError>
            </Field>

            <Field
              name="password"
              validate={(value) =>
                accountFormSchema.shape.password.validate(value)
                  ? null
                  : t(($) => $['error.passwordInvalid'], { ns: 'login' })
              }
              className="mb-5"
            >
              <FieldLabel>{t(($) => $.password, { ns: 'login' })}</FieldLabel>
              <PasswordField>
                <PasswordFieldInput
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' })}
                />
                <PasswordFieldToggle aria-label={t(($) => $.showPassword, { ns: 'login' })} />
              </PasswordField>
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
