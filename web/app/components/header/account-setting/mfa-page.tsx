'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCheckboxCircleFill, RiLoader2Line, RiShieldKeyholeLine } from '@remixicon/react'
import Toast from '../../base/toast'
import Button from '../../base/button'
import Input from '../../base/input'
import Modal from '../../base/modal'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { get, post } from '@/service/base'

// API service functions
const mfaService = {
  getStatus: async () => {
    return get<{
      enabled: boolean
      setup_at: string | null
    }>('/account/mfa/status')
  },

  initSetup: async () => {
    return post<{
      secret: string
      qr_code: string
    }>('/account/mfa/setup', { body: {} })
  },

  completeSetup: async (totpToken: string, password: string) => {
    return post<{
      message: string
      backup_codes: string[]
      setup_at: string
    }>('/account/mfa/setup/complete', {
      body: { totp_token: totpToken },
    })
  },

  disable: async (password: string) => {
    return post('/account/mfa/disable', {
      body: { password },
    })
  },
}

export default function MFAPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // State
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false)
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false)
  const [setupStep, setSetupStep] = useState<'qr' | 'verify' | 'backup'>('qr')
  const [totpToken, setTotpToken] = useState('')
  const [password, setPassword] = useState('')
  const [qrData, setQrData] = useState<{ secret: string; qr_code: string } | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])

  // Query MFA status
  const { data: mfaStatus, isLoading } = useQuery({
    queryKey: ['mfa-status'],
    queryFn: mfaService.getStatus,
  })

  // Mutations
  const initSetupMutation = useMutation({
    mutationFn: mfaService.initSetup,
    onSuccess: (data) => {
      setQrData(data)
      setIsSetupModalOpen(true)
      setSetupStep('qr')
    },
    onError: () => {
      Toast.notify({ type: 'error', message: t('common.somethingWentWrong') })
    },
  })

  const completeSetupMutation = useMutation({
    mutationFn: ({ totpToken, password }: { totpToken: string; password: string }) =>
      mfaService.completeSetup(totpToken, password),
    onSuccess: (data) => {
      setBackupCodes(data.backup_codes)
      setSetupStep('backup')
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] })
    },
    onError: () => {
      Toast.notify({ type: 'error', message: t('mfa.invalidToken') })
    },
  })

  const disableMutation = useMutation({
    mutationFn: mfaService.disable,
    onSuccess: () => {
      setIsDisableModalOpen(false)
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] })
      Toast.notify({ type: 'success', message: t('mfa.disabledSuccessfully') })
    },
    onError: () => {
      Toast.notify({ type: 'error', message: t('mfa.invalidPassword') })
    },
  })

  const handleSetupStart = () => {
    initSetupMutation.mutate()
  }

  const handleVerifyToken = () => {
    if (totpToken.length !== 6) {
      Toast.notify({ type: 'error', message: t('mfa.tokenLength') })
      return
    }
    completeSetupMutation.mutate({ totpToken, password: '' })
  }

  const handleDisable = () => {
    disableMutation.mutate(password)
  }

  const handleCopyBackupCodes = () => {
    const codesText = backupCodes.join('\n')
    navigator.clipboard.writeText(codesText)
    Toast.notify({ type: 'success', message: t('mfa.copied') })
  }

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <RiLoader2Line className="h-6 w-6 animate-spin text-text-tertiary" />
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="mb-2 rounded-xl bg-background-section p-6">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg-alt shadow-lg backdrop-blur-sm">
          <RiShieldKeyholeLine className="h-5 w-5 text-text-accent" />
        </div>
        <div className="system-sm-medium mb-1 text-text-secondary">{t('mfa.description')}</div>
        <div className="system-xs-regular text-text-tertiary">
          {t('mfa.securityTip')}
        </div>
      </div>

      <div className="rounded-xl border border-components-panel-border bg-components-panel-bg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-components-icon-bg-blue-ghost flex h-10 w-10 items-center justify-center rounded-lg">
              <RiShieldKeyholeLine className="text-components-icon-text-blue h-5 w-5" />
            </div>
            <div>
              <div className="system-sm-semibold text-text-primary">{t('mfa.authenticatorApp')}</div>
              <div className="system-xs-regular mt-0.5 text-text-tertiary">{t('mfa.authenticatorDescription')}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mfaStatus?.enabled && (
              <RiCheckboxCircleFill className="h-5 w-5 text-text-success" />
            )}
            <Button
              variant={mfaStatus?.enabled ? 'secondary' : 'primary'}
              onClick={() => {
                if (mfaStatus?.enabled)
                  setIsDisableModalOpen(true)
                else
                  handleSetupStart()
              }}
              loading={initSetupMutation.isPending}
            >
              {mfaStatus?.enabled ? t('mfa.disable') : t('mfa.enable')}
            </Button>
          </div>
        </div>

        {mfaStatus?.enabled && mfaStatus?.setup_at && (
          <div className="system-xs-regular mt-3 text-text-tertiary">
            {t('mfa.enabledAt', { date: new Date(mfaStatus.setup_at).toLocaleDateString() })}
          </div>
        )}
      </div>

      {/* Setup Modal */}
      <Modal
        isShow={isSetupModalOpen}
        onClose={() => setIsSetupModalOpen(false)}
        title={t('mfa.setupTitle')}
        className="!max-w-md"
      >
        {setupStep === 'qr' && qrData && (
          <div className="space-y-4">
            <p className="system-sm-regular text-text-secondary">{t('mfa.scanQRCode')}</p>
            <div className="flex justify-center">
              <img src={qrData.qr_code} alt="MFA QR Code" className="h-[200px] w-[200px]" />
            </div>
            <div className="rounded-lg border border-components-panel-border bg-components-panel-bg-blur p-3">
              <p className="system-xs-regular mb-1 text-text-tertiary">{t('mfa.secretKey')}</p>
              <code className="system-xs-regular break-all font-mono text-text-secondary">{qrData.secret}</code>
            </div>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => setSetupStep('verify')}
            >
              {t('mfa.next')}
            </Button>
          </div>
        )}

        {setupStep === 'verify' && (
          <div className="space-y-4">
            <p className="system-sm-regular text-text-secondary">{t('mfa.enterToken')}</p>
            <Input
              value={totpToken}
              onChange={e => setTotpToken(e.target.value)}
              placeholder="000000"
              maxLength={6}
              className="text-center font-mono text-2xl"
            />
            <Button
              variant="primary"
              className="w-full"
              onClick={handleVerifyToken}
              loading={completeSetupMutation.isPending}
              disabled={totpToken.length !== 6}
            >
              {t('mfa.verify')}
            </Button>
          </div>
        )}

        {setupStep === 'backup' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-util-colors-warning-warning-300 bg-util-colors-warning-warning-100 p-4">
              <p className="system-sm-semibold mb-2 text-util-colors-warning-warning-700">{t('mfa.backupCodesTitle')}</p>
              <p className="system-xs-regular text-util-colors-warning-warning-600">{t('mfa.backupCodesWarning')}</p>
            </div>
            <div className="rounded-lg border border-components-panel-border bg-components-panel-bg-blur p-4">
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, index) => (
                  <code key={index} className="system-sm-regular font-mono text-text-secondary">{code}</code>
                ))}
              </div>
            </div>
            <div className="flex space-x-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleCopyBackupCodes}
              >
                {t('mfa.copy')}
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  setIsSetupModalOpen(false)
                  Toast.notify({ type: 'success', message: t('mfa.setupSuccess') })
                }}
              >
                {t('mfa.done')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Disable Modal */}
      <Modal
        isShow={isDisableModalOpen}
        onClose={() => setIsDisableModalOpen(false)}
        title={t('mfa.disableTitle')}
        className="!max-w-md"
      >
        <div className="space-y-4">
          <p className="system-sm-regular text-text-secondary">{t('mfa.disableDescription')}</p>
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={t('common.account.password')}
            aria-label={t('mfa.enterYourPassword')}
          />
          <div className="flex space-x-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => setIsDisableModalOpen(false)}
            >
              {t('common.operation.cancel')}
            </Button>
            <Button
              variant="warning"
              className="flex-1"
              onClick={handleDisable}
              loading={disableMutation.isPending}
              disabled={!password}
            >
              {t('mfa.disable')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
