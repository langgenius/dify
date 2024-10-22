'use client'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import cn from 'classnames'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import Input from '../components/base/input'
import Button from '@/app/components/base/button'
import { changePasswordWithToken, verifyForgotPasswordToken } from '@/service/common'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'

const validPassword = /^(?=.*[a-zA-Z])(?=.*\d).{8,}$/

const ChangePasswordForm = () => {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const verifyTokenParams = {
    url: '/forgot-password/validity',
    body: { token },
  }
  const { data: verifyTokenRes, mutate: revalidateToken } = useSWR(verifyTokenParams, verifyForgotPasswordToken, {
    revalidateOnFocus: false,
  })

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
  }, [password, revalidateToken, token, valid])

  return (
    <div className={
      cn(
        'flex flex-col items-center w-full grow justify-center',
        'px-6',
        'md:px-[108px]',
      )
    }>
      {!verifyTokenRes && <Loading />}
      {verifyTokenRes && !verifyTokenRes.is_valid && (
        <div className="flex flex-col md:w-[400px]">
          <div className="w-full mx-auto">
            <div className="mb-3 flex justify-center items-center w-20 h-20 p-5 rounded-[20px] border border-gray-100 shadow-lg text-[40px] font-bold">🤷‍♂️</div>
            <h2 className="text-[32px] font-bold text-gray-900">{t('login.invalid')}</h2>
          </div>
          <div className="w-full mx-auto mt-6">
            <Button variant='primary' className='w-full !text-sm'>
              <a href="https://dify.ai">{t('login.explore')}</a>
            </Button>
          </div>
        </div>
      )}
      {verifyTokenRes && verifyTokenRes.is_valid && !showSuccess && (
        <div className='flex flex-col md:w-[400px]'>
          <div className="w-full mx-auto">
            <h2 className="text-[32px] font-bold text-gray-900">
              {t('login.changePassword')}
            </h2>
            <p className='mt-1 text-sm text-gray-600'>
              {t('login.changePasswordTip')}
            </p>
          </div>

          <div className="w-full mx-auto mt-6">
            <div className="bg-white">
              {/* Password */}
              <div className='mb-5'>
                <label htmlFor="password" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('common.account.newPassword')}
                </label>
                <Input
                  id="password"
                  type='password'
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder') || ''}
                  className='mt-1'
                />
                <div className='mt-1 text-xs text-text-secondary'>{t('login.error.passwordInvalid')}</div>
              </div>
              {/* Confirm Password */}
              <div className='mb-5'>
                <label htmlFor="confirmPassword" className="my-2 flex items-center justify-between text-sm font-medium text-gray-900">
                  {t('common.account.confirmPassword')}
                </label>
                <Input
                  id="confirmPassword"
                  type='password'
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('login.confirmPasswordPlaceholder') || ''}
                  className='mt-1'
                />
              </div>
              <div>
                <Button
                  variant='primary'
                  className='w-full !text-sm'
                  onClick={handleChangePassword}
                >
                  {t('common.operation.reset')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {verifyTokenRes && verifyTokenRes.is_valid && showSuccess && (
        <div className="flex flex-col md:w-[400px]">
          <div className="w-full mx-auto">
            <div className="mb-3 flex justify-center items-center w-20 h-20 p-5 rounded-[20px] border border-gray-100 shadow-lg text-[40px] font-bold">
              <CheckCircleIcon className='w-10 h-10 text-[#039855]' />
            </div>
            <h2 className="text-[32px] font-bold text-gray-900">
              {t('login.passwordChangedTip')}
            </h2>
          </div>
          <div className="w-full mx-auto mt-6">
            <Button variant='primary' className='w-full'>
              <a href="/signin">{t('login.passwordChanged')}</a>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChangePasswordForm
