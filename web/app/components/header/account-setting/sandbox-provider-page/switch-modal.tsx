'use client'

import type { SandboxProvider } from '@/types/sandbox-provider'
import { memo, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import { useActivateSandboxProvider } from '@/service/use-sandbox-provider'
import { PROVIDER_STATIC_LABELS } from './constants'

type SwitchModalProps = {
  provider: SandboxProvider
  onClose: () => void
}

const SwitchModal = ({
  provider,
  onClose,
}: SwitchModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()

  const { mutateAsync: activateProvider, isPending } = useActivateSandboxProvider()
  const providerLabel = PROVIDER_STATIC_LABELS[provider.provider_type as keyof typeof PROVIDER_STATIC_LABELS]
    ?? provider.provider_type

  // Determine the type based on provider configuration
  // If tenant has custom config, activate as 'user', otherwise as 'system'
  const activationType: 'system' | 'user' = provider.is_tenant_configured ? 'user' : 'system'

  const handleConfirm = useCallback(async () => {
    try {
      await activateProvider({ providerType: provider.provider_type, type: activationType })
      notify({ type: 'success', message: t('api.success', { ns: 'common' }) })
      onClose()
    }
    catch {
      // Error toast is handled by fetch layer
    }
  }, [activateProvider, provider.provider_type, activationType, notify, t, onClose])

  return (
    <Modal
      isShow
      onClose={onClose}
      title={t('sandboxProvider.switchModal.title', { ns: 'common' })}
      closable
      className="w-[480px]"
    >
      <div className="mt-4">
        {/* Warning Section */}
        <div>
          <div className="text-text-destructive system-sm-semibold">
            {t('sandboxProvider.switchModal.warning', { ns: 'common' })}
          </div>
          <div className="mt-0.5 text-text-destructive system-xs-regular">
            {t('sandboxProvider.switchModal.warningDesc', { ns: 'common' })}
          </div>
        </div>

        {/* Confirm Text */}
        <div className="mt-4 text-text-secondary system-sm-regular">
          <Trans
            i18nKey="sandboxProvider.switchModal.confirmText"
            ns="common"
            values={{ provider: providerLabel }}
            components={{ bold: <span className="system-sm-semibold" /> }}
          />
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="medium"
            onClick={onClose}
            disabled={isPending}
          >
            {t('sandboxProvider.switchModal.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="warning"
            size="medium"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {t('sandboxProvider.switchModal.confirm', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default memo(SwitchModal)
