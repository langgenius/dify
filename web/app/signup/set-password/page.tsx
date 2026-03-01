'use client'
import type { MailRegisterResponse } from '@/service/use-common'
import Cookies from 'js-cookie'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { validPassword } from '@/config'
import { useMailRegister } from '@/service/use-common'
import { cn } from '@/utils/classnames'
import { sendGAEvent } from '@/utils/gtag'

const parseUtmInfo = () => {
  const utmInfoStr = Cookies.get('utm_info')
  if (!utmInfoStr)
    return null
  try {
    return JSON.parse(utmInfoStr)
  }
  catch (e) {
    console.error('Failed to parse utm_info cookie:', e)
    return null
  }
}

const ChangePasswordForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('token') || '')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const { mutateAsync: register, isPending } = useMailRegister()

  const showErrorMessage = useCallback((message: string) => {
    Toast.notify({
      type: 'error',
      message,
    })
  }, [])

  const valid = useCallback(() => {
    if (!password.trim()) {
      showErrorMessage(t('error.passwordEmpty', { ns: 'login' }))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t('error.passwordInvalid', { ns: 'login' }))
      return false
    }
    if (password !== confirmPassword) {
      showErrorMessage(t('account.notEqual', { ns: 'common' }))
      return false
    }
    return true
  }, [password, confirmPassword, showErrorMessage, t])

  const handleSubmit = useCallback(async () => {
    if (!valid())
      return
    try {
      const res = await register({
        token,
        new_password: password,
        password_confirm: confirmPassword,
      })
      const { result } = res as MailRegisterResponse
      if (result === 'success') {
        const utmInfo = parseUtmInfo()
        trackEvent(utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success', {
          method: 'email',
          ...utmInfo,
        })

        sendGAEvent(utmInfo ? 'user_registration_success_with_utm' : 'user_registration_success', {
          method: 'email',
          ...utmInfo,
        })
        Cookies.remove('utm_info') // Clean up: remove utm_info cookie

        Toast.notify({
          type: 'success',
          message: t('api.actionSuccess', { ns: 'common' }),
        })
        router.replace('/apps')
      }
    }
    catch (error) {
      console.error(error)
    }
  }, [password, token, valid, confirmPassword, register])

  return (
    <div className={
      cn(
        'flex w-full grow flex-col items-center justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }
    >
      <div className="flex flex-col md:w-[400px]">
        <div className="mx-auto w-full">
          <h2 className="title-4xl-semi-bold text-text-primary">
            {t('changePassword', { ns: 'login' })}
          </h2>
          <p className="body-md-regular mt-2 text-text-secondary">
            {t('changePasswordTip', { ns: 'login' })}
          </p>
        </div>

        <div className="mx-auto mt-6 w-full">
          <div>
            {/* Password */}
            <div className="mb-5">
              <label htmlFor="password" className="system-md-semibold my-2 text-text-secondary">
                {t('account.newPassword', { ns: 'common' })}
              </label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder', { ns: 'login' }) || ''}
                />

              </div>
              <div className="body-xs-regular mt-1 text-text-secondary">{t('error.passwordInvalid', { ns: 'login' })}</div>
            </div>
            {/* Confirm Password */}
            <div className="mb-5">
              <label htmlFor="confirmPassword" className="system-md-semibold my-2 text-text-secondary">
                {t('account.confirmPassword', { ns: 'common' })}
              </label>
              <div className="relative mt-1">
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('confirmPasswordPlaceholder', { ns: 'login' }) || ''}
                />
              </div>
            </div>
            <div>
              <Button
                variant="primary"
                className="w-full"
                onClick={handleSubmit}
                disabled={isPending || !password || !confirmPassword}
              >
                {t('changePasswordBtn', { ns: 'login' })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChangePasswordForm
