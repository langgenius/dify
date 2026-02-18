'use client'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { useSearchParams } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { validPassword } from '@/config'
import { changePasswordWithToken } from '@/service/common'
import { useVerifyForgotPasswordToken } from '@/service/use-common'
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'
import Input from '../components/base/input'

const ChangePasswordForm = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const isTokenMissing = !token

  const {
    data: verifyTokenRes,
    refetch: revalidateToken,
  } = useVerifyForgotPasswordToken(token)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

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

  const handleChangePassword = useCallback(async () => {
    const token = searchParams.get('token') || ''

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
    }
    catch {
      await revalidateToken()
    }
  }, [confirmPassword, password, revalidateToken, searchParams, valid])

  return (
    <div className={
      cn(
        'flex w-full grow flex-col items-center justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }
    >
      {!isTokenMissing && !verifyTokenRes && <Loading />}
      {(isTokenMissing || (verifyTokenRes && !verifyTokenRes.is_valid)) && (
        <div className="flex flex-col md:w-[400px]">
          <div className="mx-auto w-full">
            <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-[20px] border border-divider-regular bg-components-option-card-option-bg p-5 text-[40px] font-bold shadow-lg">🤷‍♂️</div>
            <h2 className="text-[32px] font-bold text-text-primary">{t('invalid', { ns: 'login' })}</h2>
          </div>
          <div className="mx-auto mt-6 w-full">
            <Button variant="primary" className="w-full !text-sm">
              <a href="https://dify.ai">{t('explore', { ns: 'login' })}</a>
            </Button>
          </div>
        </div>
      )}
      {verifyTokenRes && verifyTokenRes.is_valid && !showSuccess && (
        <div className="flex flex-col md:w-[400px]">
          <div className="mx-auto w-full">
            <h2 className="text-[32px] font-bold text-text-primary">
              {t('changePassword', { ns: 'login' })}
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              {t('changePasswordTip', { ns: 'login' })}
            </p>
          </div>

          <div className="mx-auto mt-6 w-full">
            <div className="relative">
              {/* Password */}
              <div className="mb-5">
                <label htmlFor="password" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                  {t('account.newPassword', { ns: 'common' })}
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('passwordPlaceholder', { ns: 'login' }) || ''}
                  className="mt-1"
                />
                <div className="mt-1 text-xs text-text-secondary">{t('error.passwordInvalid', { ns: 'login' })}</div>
              </div>
              {/* Confirm Password */}
              <div className="mb-5">
                <label htmlFor="confirmPassword" className="my-2 flex items-center justify-between text-sm font-medium text-text-primary">
                  {t('account.confirmPassword', { ns: 'common' })}
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('confirmPasswordPlaceholder', { ns: 'login' }) || ''}
                  className="mt-1"
                />
              </div>
              <div>
                <Button
                  variant="primary"
                  className="w-full !text-sm"
                  onClick={handleChangePassword}
                >
                  {t('operation.reset', { ns: 'common' })}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {verifyTokenRes && verifyTokenRes.is_valid && showSuccess && (
        <div className="flex flex-col md:w-[400px]">
          <div className="mx-auto w-full">
            <div className="mb-3 flex h-20 w-20 items-center justify-center rounded-[20px] border border-divider-regular bg-components-option-card-option-bg p-5 text-[40px] font-bold shadow-lg">
              <CheckCircleIcon className="h-10 w-10 text-[#039855]" />
            </div>
            <h2 className="text-[32px] font-bold text-text-primary">
              {t('passwordChangedTip', { ns: 'login' })}
            </h2>
          </div>
          <div className="mx-auto mt-6 w-full">
            <Button variant="primary" className="w-full">
              <a href={`${basePath}/signin`}>{t('passwordChanged', { ns: 'login' })}</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangePasswordForm
