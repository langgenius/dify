'use client'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from 'next/navigation'
import cn from 'classnames'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import Input from '@/app/components/base/input'
import { validPassword } from '@/config'
import type { MailRegisterResponse } from '@/service/use-common'
import { useMailRegister } from '@/service/use-common'
import { trackEvent } from '@/app/components/base/amplitude'

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
        // Track registration success event
        trackEvent('user_registration_success', {
          method: 'email',
        })

        Toast.notify({
          type: 'success',
          message: t('common.api.actionSuccess'),
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
    }>
      <div className='flex flex-col md:w-[400px]'>
        <div className="mx-auto w-full">
          <h2 className="title-4xl-semi-bold text-text-primary">
            {t('login.changePassword')}
          </h2>
          <p className='body-md-regular mt-2 text-text-secondary'>
            {t('login.changePasswordTip')}
          </p>
        </div>

        <div className="mx-auto mt-6 w-full">
          <div>
            {/* Password */}
            <div className='mb-5'>
              <label htmlFor="password" className="system-md-semibold my-2 text-text-secondary">
                {t('common.account.newPassword')}
              </label>
              <div className='relative mt-1'>
                <Input
                  id="password"
                  type='password'
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('login.passwordPlaceholder') || ''}
                />

              </div>
              <div className='body-xs-regular mt-1 text-text-secondary'>{t('login.error.passwordInvalid')}</div>
            </div>
            {/* Confirm Password */}
            <div className='mb-5'>
              <label htmlFor="confirmPassword" className="system-md-semibold my-2 text-text-secondary">
                {t('common.account.confirmPassword')}
              </label>
              <div className='relative mt-1'>
                <Input
                  id="confirmPassword"
                  type='password'
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder={t('login.confirmPasswordPlaceholder') || ''}
                />
              </div>
            </div>
            <div>
              <Button
                variant='primary'
                className='w-full'
                onClick={handleSubmit}
                disabled={isPending || !password || !confirmPassword}
              >
                {t('login.changePasswordBtn')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChangePasswordForm
