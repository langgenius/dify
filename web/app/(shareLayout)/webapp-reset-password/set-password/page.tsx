'use client'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldDescription, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import {
  PasswordField,
  PasswordFieldInput,
  PasswordFieldToggle,
} from '@langgenius/dify-ui/password-field'
import { RiCheckboxCircleFill } from '@remixicon/react'
import { useCountDown } from 'ahooks'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { validPassword } from '@/config'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { changeWebAppPasswordWithToken } from '@/service/common'

const ChangePasswordForm = () => {
  const { t } = useTranslation(['common', 'login', 'accountSettings'])
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('token') || '')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  useDocumentTitle(
    showSuccess
      ? t(($) => $.passwordChangedTip, { ns: 'login' })
      : t(($) => $.changePassword, { ns: 'login' }),
  )

  const showErrorMessage = useCallback((message: string) => {
    toast.error(message)
  }, [])

  const getSignInUrl = () => {
    return `/webapp-signin?redirect_url=${searchParams.get('redirect_url') || ''}`
  }

  const AUTO_REDIRECT_TIME = 5000
  const [leftTime, setLeftTime] = useState<number | undefined>(undefined)
  const [countdown] = useCountDown({
    leftTime,
    onEnd: () => {
      router.replace(getSignInUrl())
    },
  })

  const valid = useCallback(() => {
    if (!password.trim()) {
      showErrorMessage(t(($) => $['error.passwordEmpty'], { ns: 'login' }))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t(($) => $['error.passwordInvalid'], { ns: 'login' }))
      return false
    }
    if (password !== confirmPassword) {
      showErrorMessage(t(($) => $['account.notEqual'], { ns: 'accountSettings' }))
      return false
    }
    return true
  }, [password, confirmPassword, showErrorMessage, t])

  const handleChangePassword = useCallback(async () => {
    if (!valid()) return
    try {
      await changeWebAppPasswordWithToken({
        url: '/forgot-password/resets',
        body: {
          token,
          new_password: password,
          password_confirm: confirmPassword,
        },
      })
      setShowSuccess(true)
      setLeftTime(AUTO_REDIRECT_TIME)
    } catch (error) {
      console.error(error)
    }
  }, [password, token, valid, confirmPassword])

  return (
    <div
      className={cn('flex w-full grow flex-col items-center justify-center', 'px-6', 'md:px-27')}
    >
      {!showSuccess && (
        <div className="flex flex-col md:w-100">
          <div className="mx-auto w-full">
            <h1 className="title-4xl-semi-bold text-text-primary">
              {t(($) => $.changePassword, { ns: 'login' })}
            </h1>
            <p className="mt-2 body-md-regular text-text-secondary">
              {t(($) => $.changePasswordTip, { ns: 'login' })}
            </p>
          </div>

          <div className="mx-auto mt-6 w-full">
            <Form className="bg-white" onFormSubmit={() => void handleChangePassword()}>
              <Field name="password" className="mb-5">
                <div className="grid gap-0">
                  <FieldLabel className="system-md-semibold">
                    {t(($) => $['account.newPassword'], { ns: 'accountSettings' })}
                  </FieldLabel>
                  <PasswordField>
                    <PasswordFieldInput
                      autoComplete="new-password"
                      value={password}
                      onValueChange={setPassword}
                      placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
                    />
                    <PasswordFieldToggle aria-label={t(($) => $.showPassword, { ns: 'login' })} />
                  </PasswordField>
                </div>
                <FieldDescription className="py-0 body-xs-regular text-text-secondary">
                  {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
                </FieldDescription>
              </Field>
              <Field name="confirmPassword" className="mb-5 gap-0">
                <FieldLabel className="system-md-semibold">
                  {t(($) => $['account.confirmPassword'], { ns: 'accountSettings' })}
                </FieldLabel>
                <PasswordField>
                  <PasswordFieldInput
                    autoComplete="new-password"
                    value={confirmPassword}
                    onValueChange={setConfirmPassword}
                    placeholder={t(($) => $.confirmPasswordPlaceholder, { ns: 'login' }) || ''}
                  />
                  <PasswordFieldToggle aria-label={t(($) => $.showPassword, { ns: 'login' })} />
                </PasswordField>
              </Field>
              <Button type="submit" variant="primary" className="w-full">
                {t(($) => $.changePasswordBtn, { ns: 'login' })}
              </Button>
            </Form>
          </div>
        </div>
      )}
      {showSuccess && (
        <div className="flex flex-col md:w-100">
          <div className="mx-auto w-full">
            <div className="mb-3 flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle font-bold shadow-lg">
              <RiCheckboxCircleFill aria-hidden="true" className="size-6 text-text-success" />
            </div>
            <h1 className="title-4xl-semi-bold text-text-primary">
              {t(($) => $.passwordChangedTip, { ns: 'login' })}
            </h1>
          </div>
          <div className="mx-auto mt-6 w-full">
            <Link
              href={getSignInUrl()}
              replace
              className={cn(buttonVariants({ variant: 'primary' }), 'w-full')}
            >
              {t(($) => $.passwordChanged, { ns: 'login' })} ({Math.round(countdown / 1000)}){' '}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangePasswordForm
