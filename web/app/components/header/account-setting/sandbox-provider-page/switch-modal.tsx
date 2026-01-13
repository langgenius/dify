'use client'

import type { SandboxProvider } from '@/service/use-sandbox-provider'
import { memo, useCallback } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import { useActivateSandboxProvider } from '@/service/use-sandbox-provider'

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

  const handleConfirm = useCallback(async () => {
    try {
      await activateProvider(provider.provider_type)
      notify({ type: 'success', message: t('api.success', { ns: 'common' }) })
      onClose()
    }
    catch {
      // Error toast is handled by fetch layer
    }
  }, [activateProvider, provider.provider_type, notify, t, onClose])

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
          <div className="system-sm-semibold text-text-destructive">
            {t('sandboxProvider.switchModal.warning', { ns: 'common' })}
          </div>
          <div className="system-xs-regular mt-0.5 text-text-destructive">
            {t('sandboxProvider.switchModal.warningDesc', { ns: 'common' })}
          </div>
        </div>

        {/* Confirm Text */}
        <div className="system-sm-regular mt-4 text-text-secondary">
          <Trans
            i18nKey="sandboxProvider.switchModal.confirmText"
            ns="common"
            values={{ provider: provider.label }}
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
