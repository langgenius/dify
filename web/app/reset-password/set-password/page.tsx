'use client'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from 'next/navigation'
import cn from 'classnames'
import { RiCheckboxCircleFill } from '@remixicon/react'
import { useCountDown } from 'ahooks'
import Button from '@/app/components/base/button'
import { changePasswordWithToken } from '@/service/common'
import Toast from '@/app/components/base/toast'
import Input from '@/app/components/base/input'

const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

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
      showErrorMessage(t('login.error.passwordEmpty'))
      return false
    }
    if (!validPassword.test(password)) {
      showErrorMessage(t('login.error.passwordInvalid'))
      return false
    }
    if (password !== confirmPassword) {
      showErrorMessage(t('common.account.notEqual'))
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
    }>
      {!showSuccess && (
        <div className='flex flex-col md:w-[400px]'>
          <div className="mx-auto w-full">
            <h2 className="title-4xl-semi-bold text-text-primary">
              {t('login.changePassword')}
            </h2>
            <p className='body-md-regular text-text-secondary mt-2'>
              {t('login.changePasswordTip')}
            </p>
          </div>

          <div className="mx-auto mt-6 w-full">
            <div className="bg-white">
              {/* Password */}
              <div className='mb-5'>
                <label htmlFor="password" className="system-md-semibold text-text-secondary my-2">
                  {t('common.account.newPassword')}
                </label>
                <div className='relative mt-1'>
                  <Input
                    id="password" type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('login.passwordPlaceholder') || ''}
                  />

                  <div className="absolute inset-y-0 right-0 flex items-center">
                    <Button
                      type="button"
                      variant='ghost'
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? '👀' : '😝'}
                    </Button>
                  </div>
                </div>
                <div className='body-xs-regular text-text-secondary mt-1'>{t('login.error.passwordInvalid')}</div>
              </div>
              {/* Confirm Password */}
              <div className='mb-5'>
                <label htmlFor="confirmPassword" className="system-md-semibold text-text-secondary my-2">
                  {t('common.account.confirmPassword')}
                </label>
                <div className='relative mt-1'>
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder={t('login.confirmPasswordPlaceholder') || ''}
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center">
                    <Button
                      type="button"
                      variant='ghost'
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? '👀' : '😝'}
                    </Button>
                  </div>
                </div>
              </div>
              <div>
                <Button
                  variant='primary'
                  className='w-full'
                  onClick={handleChangePassword}
                >
                  {t('login.changePasswordBtn')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSuccess && (
        <div className="flex flex-col md:w-[400px]">
          <div className="mx-auto w-full">
            <div className="border-components-panel-border-subtle mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border font-bold shadow-lg">
              <RiCheckboxCircleFill className='text-text-success h-6 w-6' />
            </div>
            <h2 className="title-4xl-semi-bold text-text-primary">
              {t('login.passwordChangedTip')}
            </h2>
          </div>
          <div className="mx-auto mt-6 w-full">
            <Button variant='primary' className='w-full' onClick={() => {
              setLeftTime(undefined)
              router.replace(getSignInUrl())
            }}>{t('login.passwordChanged')} ({Math.round(countdown / 1000)}) </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangePasswordForm
