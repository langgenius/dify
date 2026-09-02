'use client'
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
import { Input } from '@langgenius/dify-ui/input'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { validPassword } from '@/config'
import useDocumentTitle from '@/hooks/use-document-title'
import { useSearchParams } from '@/next/navigation'
import { changePasswordWithToken } from '@/service/common'
import { useVerifyForgotPasswordToken } from '@/service/use-common'
import { basePath } from '@/utils/var'

const ChangePasswordForm = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const isTokenMissing = !token

  const { data: verifyTokenRes, refetch: revalidateToken } = useVerifyForgotPasswordToken(token)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const isVerifyingToken = !isTokenMissing && !verifyTokenRes
  const isTokenInvalid = isTokenMissing || (verifyTokenRes && !verifyTokenRes.is_valid)
  const documentTitle = isVerifyingToken
    ? t(($) => $.loading, { ns: 'common' })
    : isTokenInvalid
      ? t(($) => $.invalid, { ns: 'login' })
      : showSuccess
        ? t(($) => $.passwordChangedTip, { ns: 'login' })
        : t(($) => $.changePassword, { ns: 'login' })
  useDocumentTitle(documentTitle)

  const handleChangePassword = useCallback(async () => {
    if (isSubmitting) return
    const resetToken = verifyTokenRes?.token ?? ''

    setIsSubmitting(true)
    try {
      await changePasswordWithToken({
        url: '/forgot-password/resets',
        body: {
          token: resetToken,
          new_password: password,
          password_confirm: confirmPassword,
        },
      })
      setShowSuccess(true)
    } catch {
      await revalidateToken()
    } finally {
      setIsSubmitting(false)
    }
  }, [confirmPassword, isSubmitting, password, revalidateToken, verifyTokenRes?.token])

  return (
    <div
      className={cn('flex w-full grow flex-col items-center justify-center', 'px-6', 'md:px-27')}
    >
      {isVerifyingToken && <Loading />}
      {isTokenInvalid && (
        <div className="flex flex-col md:w-100">
          <div className="mx-auto w-full">
            <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-[20px] border border-divider-regular bg-components-option-card-option-bg p-5 text-[40px] font-bold shadow-lg">
              🤷‍♂️
            </div>
            <h1 className="text-[32px] font-bold text-text-primary">
              {t(($) => $.invalid, { ns: 'login' })}
            </h1>
          </div>
          <div className="mx-auto mt-6 w-full">
            <a
              href="https://dify.ai"
              className={cn(buttonVariants({ variant: 'primary' }), 'w-full text-sm!')}
            >
              {t(($) => $.explore, { ns: 'login' })}
            </a>
          </div>
        </div>
      )}
      {verifyTokenRes && verifyTokenRes.is_valid && !showSuccess && (
        <div className="flex flex-col md:w-100">
          <div className="mx-auto w-full">
            <h1 className="text-[32px] font-bold text-text-primary">
              {t(($) => $.changePassword, { ns: 'login' })}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {t(($) => $.changePasswordTip, { ns: 'login' })}
            </p>
          </div>

          <div className="mx-auto mt-6 w-full">
            <Form
              className="relative"
              onFormSubmit={() => {
                void handleChangePassword()
              }}
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
                <Input
                  type="password"
                  required
                  autoComplete="new-password"
                  spellCheck={false}
                  value={password}
                  onValueChange={setPassword}
                  placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
                />
                <FieldValidity>
                  {({ validity }) =>
                    validity.valid !== false ? (
                      <FieldDescription>
                        {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
                      </FieldDescription>
                    ) : null
                  }
                </FieldValidity>
                <FieldError>
                  {t(($) => $[password.trim() ? 'error.passwordInvalid' : 'error.passwordEmpty'], {
                    ns: 'login',
                  })}
                </FieldError>
              </Field>
              <Field
                name="confirmPassword"
                validate={(value) => {
                  const confirmationValue = String(value)
                  return !confirmationValue || confirmationValue === password
                    ? null
                    : t(($) => $['account.notEqual'], { ns: 'common' })
                }}
                className="mb-5"
              >
                <FieldLabel>{t(($) => $['account.confirmPassword'], { ns: 'common' })}</FieldLabel>
                <Input
                  type="password"
                  required
                  autoComplete="new-password"
                  spellCheck={false}
                  value={confirmPassword}
                  onValueChange={setConfirmPassword}
                  placeholder={t(($) => $.confirmPasswordPlaceholder, { ns: 'login' }) || ''}
                />
                <FieldError>{t(($) => $['account.notEqual'], { ns: 'common' })}</FieldError>
              </Field>
              <Button
                type="submit"
                variant="primary"
                className="w-full text-sm!"
                loading={isSubmitting}
              >
                {t(($) => $['operation.reset'], { ns: 'common' })}
              </Button>
            </Form>
          </div>
        </div>
      )}
      {verifyTokenRes && verifyTokenRes.is_valid && showSuccess && (
        <div className="flex flex-col md:w-100">
          <div className="mx-auto w-full">
            <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-[20px] border border-divider-regular bg-components-option-card-option-bg p-5 text-[40px] font-bold shadow-lg">
              <span
                className="i-heroicons-check-circle-solid size-10 text-text-success"
                aria-hidden="true"
              />
            </div>
            <h1 className="text-[32px] font-bold text-text-primary">
              {t(($) => $.passwordChangedTip, { ns: 'login' })}
            </h1>
          </div>
          <div className="mx-auto mt-6 w-full">
            <a
              href={`${basePath}/signin`}
              className={cn(buttonVariants({ variant: 'primary' }), 'w-full')}
            >
              {t(($) => $.passwordChanged, { ns: 'login' })}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangePasswordForm
