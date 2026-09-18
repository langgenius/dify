'use client'
import type { FormActions } from '@langgenius/dify-ui/form'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldValidity,
} from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useCountDown } from 'ahooks'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validPassword } from '@/config'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { changePasswordWithToken } from '@/service/common'

type PasswordFormValues = {
  password: string
  confirmPassword: string
}

const ChangePasswordForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('token') || '')

  const formActionsRef = useRef<FormActions>(null)
  const confirmPasswordRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  useDocumentTitle(
    showSuccess
      ? t(($) => $.passwordChangedTip, { ns: 'login' })
      : t(($) => $.changePassword, { ns: 'login' }),
  )

  const getSignInUrl = () => {
    if (searchParams.has('invite_token')) {
      const params = new URLSearchParams()
      params.set('token', searchParams.get('invite_token') as string)
      return `/activate?${params.toString()}`
    }

    const redirectUrl = searchParams.get('redirect_url')
    if (redirectUrl) {
      const params = new URLSearchParams()
      params.set('redirect_url', redirectUrl)
      return `/signin?${params.toString()}`
    }

    return '/signin'
  }

  const AUTO_REDIRECT_TIME = 5000
  const [leftTime, setLeftTime] = useState<number | undefined>(undefined)
  const [countdown] = useCountDown({
    leftTime,
    onEnd: () => {
      router.replace(getSignInUrl())
    },
  })

  const handleChangePassword = useCallback(
    async (formValues: PasswordFormValues) => {
      if (isSubmitting) return
      setIsSubmitting(true)
      try {
        await changePasswordWithToken({
          url: '/forgot-password/resets',
          body: {
            token,
            new_password: formValues.password,
            password_confirm: formValues.confirmPassword,
          },
        })
        setShowSuccess(true)
        setLeftTime(AUTO_REDIRECT_TIME)
      } catch (error) {
        console.error(error)
      } finally {
        setIsSubmitting(false)
      }
    },
    [isSubmitting, token],
  )

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
            <Form<PasswordFormValues>
              actionsRef={formActionsRef}
              onFormSubmit={(formValues) => void handleChangePassword(formValues)}
            >
              <Field
                name="password"
                validate={(value) => {
                  const passwordValue = String(value)
                  if (!passwordValue.trim())
                    return t(($) => $['error.passwordEmpty'], { ns: 'login' })
                  return validPassword.test(passwordValue)
                    ? null
                    : t(($) => $['error.passwordInvalid'], { ns: 'login' })
                }}
                className="mb-5"
              >
                <FieldLabel>{t(($) => $['account.newPassword'], { ns: 'common' })}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    spellCheck={false}
                    onValueChange={() => {
                      if (confirmPasswordRef.current?.value)
                        formActionsRef.current?.validate('confirmPassword')
                    }}
                    placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
                  />
                  <InputGroupAddon align="inline-end">
                    <IconButton
                      aria-label={t(($) => $[showPassword ? 'hidePassword' : 'showPassword'], {
                        ns: 'login',
                      })}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      <span
                        className={
                          showPassword ? 'i-ri-eye-off-line size-4' : 'i-ri-eye-line size-4'
                        }
                        aria-hidden="true"
                      />
                    </IconButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldValidity>
                  {({ validity }) =>
                    validity.valid !== false ? (
                      <FieldDescription>
                        {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
                      </FieldDescription>
                    ) : null
                  }
                </FieldValidity>
                <FieldValidity>
                  {({ validity }) => (
                    <FieldError>
                      {t(
                        ($) =>
                          $[
                            validity.valueMissing ? 'error.passwordEmpty' : 'error.passwordInvalid'
                          ],
                        { ns: 'login' },
                      )}
                    </FieldError>
                  )}
                </FieldValidity>
              </Field>
              <Field
                name="confirmPassword"
                validate={(value, formValues) => {
                  const confirmationValue = String(value)
                  return !confirmationValue || confirmationValue === formValues.password
                    ? null
                    : t(($) => $['account.notEqual'], { ns: 'common' })
                }}
                className="mb-5"
              >
                <FieldLabel>{t(($) => $['account.confirmPassword'], { ns: 'common' })}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    autoComplete="new-password"
                    spellCheck={false}
                    ref={confirmPasswordRef}
                    placeholder={t(($) => $.confirmPasswordPlaceholder, { ns: 'login' }) || ''}
                  />
                  <InputGroupAddon align="inline-end">
                    <IconButton
                      aria-label={t(
                        ($) => $[showConfirmPassword ? 'hidePassword' : 'showPassword'],
                        { ns: 'login' },
                      )}
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      <span
                        className={
                          showConfirmPassword ? 'i-ri-eye-off-line size-4' : 'i-ri-eye-line size-4'
                        }
                        aria-hidden="true"
                      />
                    </IconButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError>{t(($) => $['account.notEqual'], { ns: 'common' })}</FieldError>
              </Field>
              <Button type="submit" variant="primary" className="w-full" loading={isSubmitting}>
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
              <span
                className="i-ri-checkbox-circle-fill size-6 text-text-success"
                aria-hidden="true"
              />
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
