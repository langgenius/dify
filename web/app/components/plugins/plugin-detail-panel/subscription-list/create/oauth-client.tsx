'use client'
import type { TriggerOAuthConfig, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import {
  RiClipboardLine,
  RiInformation2Fill,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { BaseForm } from '@/app/components/base/form/components/base'
import Modal from '@/app/components/base/modal/modal'
import Toast from '@/app/components/base/toast'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { usePluginStore } from '../../store'
import { ClientTypeEnum, useOAuthClientState } from './hooks/use-oauth-client-state'

type Props = {
  oauthConfig?: TriggerOAuthConfig
  onClose: () => void
  showOAuthCreateModal: (builder: TriggerSubscriptionBuilder) => void
}

const CLIENT_TYPE_OPTIONS = [ClientTypeEnum.Default, ClientTypeEnum.Custom] as const

export const OAuthClientSettingsModal = ({ oauthConfig, onClose, showOAuthCreateModal }: Props) => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const providerName = detail?.provider || ''

  const {
    clientType,
    setClientType,
    clientFormRef,
    oauthClientSchema,
    confirmButtonText,
    handleRemove,
    handleSave,
  } = useOAuthClientState({
    oauthConfig,
    providerName,
    onClose,
    showOAuthCreateModal,
  })

  const isCustomClient = clientType === ClientTypeEnum.Custom
  const showRemoveButton = oauthConfig?.custom_enabled && oauthConfig?.params && isCustomClient
  const showRedirectInfo = isCustomClient && oauthConfig?.redirect_uri
  const showClientForm = isCustomClient && oauthClientSchema.length > 0

  const handleCopyRedirectUri = () => {
    navigator.clipboard.writeText(oauthConfig?.redirect_uri || '')
    Toast.notify({
      type: 'success',
      message: t('actionMsg.copySuccessfully', { ns: 'common' }),
    })
  }

  return (
    <Modal
      title={t('modal.oauth.title', { ns: 'pluginTrigger' })}
      confirmButtonText={confirmButtonText}
      cancelButtonText={t('auth.saveOnly', { ns: 'plugin' })}
      extraButtonText={t('operation.cancel', { ns: 'common' })}
      showExtraButton
      clickOutsideNotClose
      extraButtonVariant="secondary"
      onExtraButtonClick={onClose}
      onClose={onClose}
      onCancel={() => handleSave(false)}
      onConfirm={() => handleSave(true)}
      footerSlot={showRemoveButton && (
        <div className="grow">
          <Button
            variant="secondary"
            className="text-components-button-destructive-secondary-text"
            onClick={handleRemove}
          >
            {t('operation.remove', { ns: 'common' })}
          </Button>
        </div>
      )}
    >
      <div className="system-sm-medium mb-2 text-text-secondary">
        {t('subscription.addType.options.oauth.clientTitle', { ns: 'pluginTrigger' })}
      </div>

      {oauthConfig?.system_configured && (
        <div className="mb-4 flex w-full items-start justify-between gap-2">
          {CLIENT_TYPE_OPTIONS.map(option => (
            <OptionCard
              key={option}
              title={t(`subscription.addType.options.oauth.${option}`, { ns: 'pluginTrigger' })}
              onSelect={() => setClientType(option)}
              selected={clientType === option}
              className="flex-1"
            />
          ))}
        </div>
      )}

      {showRedirectInfo && (
        <div className="mb-4 flex items-start gap-3 rounded-xl bg-background-section-burn p-4">
          <div className="rounded-lg border-[0.5px] border-components-card-border bg-components-card-bg p-2 shadow-xs shadow-shadow-shadow-3">
            <RiInformation2Fill className="h-5 w-5 shrink-0 text-text-accent" />
          </div>
          <div className="flex-1 text-text-secondary">
            <div className="system-sm-regular whitespace-pre-wrap leading-4">
              {t('modal.oauthRedirectInfo', { ns: 'pluginTrigger' })}
            </div>
            <div className="system-sm-medium my-1.5 break-all leading-4">
              {oauthConfig?.redirect_uri}
            </div>
            <Button
              variant="secondary"
              size="small"
              onClick={handleCopyRedirectUri}
            >
              <RiClipboardLine className="mr-1 h-[14px] w-[14px]" />
              {t('operation.copy', { ns: 'common' })}
            </Button>
          </div>
        </div>
      )}

      {showClientForm && (
        <BaseForm
          formSchemas={oauthClientSchema}
          ref={clientFormRef}
          labelClassName="system-sm-medium mb-2 block text-text-secondary"
          formClassName="space-y-4"
        />
      )}
    </Modal>
  )
}
