'use client'

import type { SandboxProvider } from '@/service/use-sandbox-provider'
import { RiAlertLine } from '@remixicon/react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import {
  useActivateSandboxProvider,
  useInvalidSandboxProviderList,
} from '@/service/use-sandbox-provider'

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
  const invalidateList = useInvalidSandboxProviderList()

  const { mutateAsync: activateProvider, isPending } = useActivateSandboxProvider()

  const handleConfirm = useCallback(async () => {
    try {
      await activateProvider(provider.provider_type)
      await invalidateList()
      notify({ type: 'success', message: t('api.success', { ns: 'common' }) })
      onClose()
    }
    catch {
      // Error toast is handled by fetch layer
    }
  }, [activateProvider, provider.provider_type, invalidateList, notify, t, onClose])

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
        <div className="flex gap-3 rounded-xl bg-state-warning-hover p-3">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-state-warning-solid">
            <RiAlertLine className="h-3 w-3 text-text-warning-secondary" />
          </div>
          <div>
            <div className="system-sm-semibold text-text-primary">
              {t('sandboxProvider.switchModal.warning', { ns: 'common' })}
            </div>
            <div className="system-xs-regular mt-1 text-text-secondary">
              {t('sandboxProvider.switchModal.warningDesc', { ns: 'common' })}
            </div>
          </div>
        </div>

        {/* Confirm Text */}
        <div className="system-sm-regular mt-4 text-text-secondary">
          {t('sandboxProvider.switchModal.confirmText', { ns: 'common', provider: provider.label })}
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
            variant="primary"
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
