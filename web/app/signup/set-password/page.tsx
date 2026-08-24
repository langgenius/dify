'use client'
import type { MailRegisterResponse } from '@/service/use-common'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldDescription, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import Cookies from 'js-cookie'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { rememberRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
import { resolvePostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import { validPassword } from '@/config'
import { useLocale } from '@/context/i18n'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useMailRegister } from '@/service/use-common'
import { rememberCreateAppExternalAttribution } from '@/utils/create-app-tracking'
import { sendGAEvent } from '@/utils/gtag'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { getBrowserTimezone } from '@/utils/timezone'
import { basePath } from '@/utils/var'

const parseUtmInfo = () => {
  const utmInfoStr = Cookies.get('utm_info')
  if (!utmInfoStr) return null
  try {
    return JSON.parse(utmInfoStr)
  } catch (e) {
    console.error('Failed to parse utm_info cookie:', e)
    return null
  }
}

const ChangePasswordForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('token') || '')
  const locale = useLocale()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { mutateAsync: register, isPending } = useMailRegister()
  const pageTitle = t(($) => $.changePassword, { ns: 'login' })
  useDocumentTitle(pageTitle)

  const showErrorMessage = useCallback((message: string) => {
    toast.error(message)
  }, [])

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
      showErrorMessage(t(($) => $['account.notEqual'], { ns: 'common' }))
      return false
    }
    return true
  }, [password, confirmPassword, showErrorMessage, t])

  const handleSubmit = useCallback(async () => {
    if (!valid()) return
    try {
      const res = await register({
        token,
        new_password: password,
        password_confirm: confirmPassword,
        language: locale,
        timezone: getBrowserTimezone(),
      })
      const { result } = res as MailRegisterResponse
      if (result === 'success') {
        const utmInfo = parseUtmInfo()
        rememberCreateAppExternalAttribution({ utmInfo })
        // Defer the Amplitude event until the user ID is attached. The app context
        // external sync replays it after setUserId runs once the redirect lands on /apps.
        // Firing it here would record it under an anonymous Amplitude profile.
        rememberRegistrationSuccess({ method: 'email', utmInfo })

        sendGAEvent(utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success', {
          method: 'email',
          ...utmInfo,
        })
        Cookies.remove('utm_info') // Clean up: remove utm_info cookie

        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
        await queryClient.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })
        replaceLoginRedirect(resolvePostLoginRedirect(searchParams), router.replace, basePath)
      }
    } catch (error) {
      console.error(error)
    }
  }, [
    password,
    token,
    valid,
    confirmPassword,
    register,
    locale,
    queryClient,
    router,
    searchParams,
    t,
  ])

  return (
    <div
      className={cn('flex w-full grow flex-col items-center justify-center', 'px-6', 'md:px-27')}
    >
      <div className="flex flex-col md:w-100">
        <div className="mx-auto w-full">
          <h1 className="title-4xl-semi-bold text-text-primary">{pageTitle}</h1>
          <p className="mt-2 body-md-regular text-text-secondary">
            {t(($) => $.changePasswordTip, { ns: 'login' })}
          </p>
        </div>

        <div className="mx-auto mt-6 w-full">
          <Form onFormSubmit={() => void handleSubmit()}>
            <Field name="password" className="mb-5">
              <FieldLabel className="py-0 text-[14px] leading-5 font-semibold text-text-secondary">
                {t(($) => $['account.newPassword'], { ns: 'common' })}
              </FieldLabel>
              <Input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={password}
                onValueChange={setPassword}
                placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
              />
              <FieldDescription className="py-0 text-text-secondary">
                {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
              </FieldDescription>
            </Field>
            <Field name="confirmPassword" className="mb-5">
              <FieldLabel className="py-0 text-[14px] leading-5 font-semibold text-text-secondary">
                {t(($) => $['account.confirmPassword'], { ns: 'common' })}
              </FieldLabel>
              <Input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={confirmPassword}
                onValueChange={setConfirmPassword}
                placeholder={t(($) => $.confirmPasswordPlaceholder, { ns: 'login' }) || ''}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={isPending || !password || !confirmPassword}
            >
              {t(($) => $.changePasswordBtn, { ns: 'login' })}
            </Button>
          </Form>
        </div>
      </div>
    </div>
  )
}

export default ChangePasswordForm
