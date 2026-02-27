'use client'
import { RiCheckboxCircleFill } from '@remixicon/react'
import { useCountDown } from 'ahooks'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Toast from '@/app/components/base/toast'
import { validPassword } from '@/config'
import { changePasswordWithToken } from '@/service/common'
import { cn } from '@/utils/classnames'

const ChangePasswordForm = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = decodeURIComponent(searchParams.get('token') || '')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const showErrorMessage = useCallback((message: string) => {
    Toast.notify({
      type: 'error',
      message,
    })
  }, [])

  const getSignInUrl = () => {
    if (searchParams.has('invite_token')) {
      const params = new URLSearchParams()
      params.set('token', searchParams.get('invite_token') as string)
      return `/activate?${params.toString()}`
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

  const handleChangePassword = useCallback(async () => {
    if (!valid())
      return
    try {
      await changePasswordWithToken({
        url: '/forgot-password/resets',
        body: {
          token,
          new_password: password,
          password_confirm: confirmPassword,
        },
      })
      setShowSuccess(true)
      setLeftTime(AUTO_REDIRECT_TIME)
    }
    catch (error) {
      console.error(error)
    }
  }, [password, token, valid, confirmPassword])

  return (
    <div className={
      cn(
        'flex w-full grow flex-col items-center justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }
    >
      {!showSuccess && (
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
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('passwordPlaceholder', { ns: 'login' }) || ''}
                  />

                  <div className="absolute inset-y-0 right-0 flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? '👀' : '😝'}
                    </Button>
                  </div>
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
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder={t('confirmPasswordPlaceholder', { ns: 'login' }) || ''}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? '👀' : '😝'}
                    </Button>
                  </div>
                </div>
              </div>
              <div>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={handleChangePassword}
                >
                  {t('changePasswordBtn', { ns: 'login' })}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSuccess && (
        <div className="flex flex-col md:w-[400px]">
          <div className="mx-auto w-full">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle font-bold shadow-lg">
              <RiCheckboxCircleFill className="h-6 w-6 text-text-success" />
            </div>
            <h2 className="title-4xl-semi-bold text-text-primary">
              {t('passwordChangedTip', { ns: 'login' })}
            </h2>
          </div>
          <div className="mx-auto mt-6 w-full">
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                setLeftTime(undefined)
                router.replace(getSignInUrl())
              }}
            >
              {t('passwordChanged', { ns: 'login' })}
              {' '}
              (
              {Math.round(countdown / 1000)}
              )
              {' '}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangePasswordForm
