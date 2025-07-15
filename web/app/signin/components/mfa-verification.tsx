import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { RiShieldKeyholeLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import Input from '@/app/components/base/input'
import { login } from '@/service/common'

type MFAVerificationProps = {
  email: string
  password: string
  inviteToken?: string
  isInvite: boolean
  locale: string
}

export default function MFAVerification({ email, password, inviteToken, isInvite, locale }: MFAVerificationProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const [mfaCode, setMfaCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleMFAVerification = async () => {
    const expectedLength = useBackupCode ? 8 : 6
    if (!mfaCode || mfaCode.length !== expectedLength) {
      Toast.notify({ 
        type: 'error', 
        message: useBackupCode 
          ? 'Backup code must be 8 characters' 
          : t('mfa.tokenLength')
      })
      return
    }

    try {
      setIsLoading(true)
      const loginData: Record<string, any> = {
        email,
        password,
        mfa_code: mfaCode,
        is_backup_code: useBackupCode,
        language: locale,
        remember_me: true,
      }
      
      if (isInvite && inviteToken)
        loginData.invite_token = inviteToken

      console.log('Sending MFA login request with data:', { ...loginData, password: '[HIDDEN]' })

      const res = await login({
        url: '/login',
        body: loginData,
      })

      console.log('MFA login response:', res)
      console.log('Response type:', typeof res, 'Result:', res.result, 'Data keys:', res.data ? Object.keys(res.data) : 'no data')
      if (res.result === 'success') {
        console.log('MFA authentication successful!', 'isInvite:', isInvite, 'useBackupCode:', useBackupCode)
        if (isInvite) {
          console.log('Redirecting to invite settings')
          const params = new URLSearchParams()
          if (inviteToken)
            params.append('invite_token', inviteToken)
          router.replace(`/signin/invite-settings?${params.toString()}`)
        }
        else {
          console.log('Setting tokens and redirecting to /apps')
          console.log('Access token exists:', !!res.data.access_token, 'Refresh token exists:', !!res.data.refresh_token)
          localStorage.setItem('console_token', res.data.access_token)
          localStorage.setItem('refresh_token', res.data.refresh_token)
          console.log('Tokens set, calling router.replace(/apps)')
          router.replace('/apps')
          console.log('router.replace(/apps) called')
        }
      }
      else if (res.code === 'mfa_token_invalid') {
        console.log('MFA authentication failed: invalid token')
        Toast.notify({
          type: 'error',
          message: t('mfa.invalidToken'),
        })
      }
      else {
        console.log('MFA authentication failed:', res)
        Toast.notify({
          type: 'error',
          message: res.data || t('mfa.invalidToken'),
        })
      }
    }
    catch (error: any) {
      console.error('MFA authentication error:', error)
      
      // Handle different types of errors
      let errorMessage = t('mfa.invalidToken')
      if (error?.response?.status === 401) {
        errorMessage = t('mfa.invalidToken')
      } else if (error?.message) {
        errorMessage = error.message
      }
      
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-state-base-hover">
          <RiShieldKeyholeLine className="h-8 w-8 text-text-secondary" />
        </div>
      </div>
      
      <h3 className="title-xl-semi-bold mb-2 text-center text-text-primary">
        {t('mfa.mfaRequired')}
      </h3>
      <p className="body-md-regular mb-6 text-center text-text-tertiary">
        {t('mfa.mfaRequiredDescription')}
      </p>

      <div className="mb-4">
        <label htmlFor="mfa-code" className="system-md-semibold mb-2 block text-text-secondary">
          {t(useBackupCode ? 'mfa.backupCode' : 'mfa.authenticatorCode')}
        </label>
        <Input
          id="mfa-code"
          value={mfaCode}
          onChange={e => {
            const value = e.target.value
            if (useBackupCode) {
              // For backup codes, allow alphanumeric characters
              setMfaCode(value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
            } else {
              // For TOTP codes, allow only digits
              setMfaCode(value.replace(/\D/g, ''))
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              handleMFAVerification()
          }}
          placeholder={useBackupCode ? 'A1B2C3D4' : '123456'}
          maxLength={useBackupCode ? 8 : 6}
          className="text-center text-2xl font-mono"
          autoFocus
        />
      </div>

      <Button
        variant="primary"
        onClick={handleMFAVerification}
        disabled={isLoading || !mfaCode || mfaCode.length !== (useBackupCode ? 8 : 6)}
        className="mb-3 w-full"
      >
        {t('mfa.verify')}
      </Button>

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setUseBackupCode(!useBackupCode)
            setMfaCode('')
          }}
          className="system-xs-medium text-components-button-secondary-accent-text hover:underline"
        >
          {t(useBackupCode ? 'mfa.authenticatorCode' : 'mfa.useBackupCode')}
        </button>
      </div>
    </div>
  )
}