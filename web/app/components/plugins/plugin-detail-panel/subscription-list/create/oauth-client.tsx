'use client'
import type { TriggerOAuthConfig, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { BaseForm } from '@/app/components/base/form/components/base'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { usePluginStore } from '../../store'
import { ClientTypeEnum, useOAuthClientState as useOAuthClientSettings } from './hooks/use-oauth-client-state'

type Props = {
  open: boolean
  oauthConfig?: TriggerOAuthConfig
  onOpenChange: (open: boolean) => void
  showOAuthCreateModal: (builder: TriggerSubscriptionBuilder) => void
}

const CLIENT_TYPE_OPTIONS = [ClientTypeEnum.Default, ClientTypeEnum.Custom] as const

export const OAuthClientSettingsModal = ({ open, oauthConfig, onOpenChange, showOAuthCreateModal }: Props) => {
  const { t } = useTranslation()
  const detail = usePluginStore(state => state.detail)
  const providerName = detail?.provider || ''
  const closeModal = useCallback(() => onOpenChange(false), [onOpenChange])

  const oauthClientSettings = useOAuthClientSettings({
    oauthConfig,
    providerName,
    onOpenChange,
    showOAuthCreateModal,
  })
  const {
    clientType,
    setClientType,
    clientFormRef,
    oauthClientSchema,
    confirmButtonText,
    handleRemove,
    handleSave,
  } = oauthClientSettings

  const isCustomClient = clientType === ClientTypeEnum.Custom
  const showRemoveButton = oauthConfig?.custom_enabled && oauthConfig?.params && isCustomClient
  const showRedirectInfo = isCustomClient && oauthConfig?.redirect_uri
  const showClientForm = isCustomClient && oauthClientSchema.length > 0

  const handleCopyRedirectUri = () => {
    navigator.clipboard.writeText(oauthConfig?.redirect_uri || '')
    toast.success(t('actionMsg.copySuccessfully', { ns: 'common' }))
  }

  const title = t('modal.oauth.title', { ns: 'pluginTrigger' })

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={onOpenChange}
    >
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="p-0"
      >
        <div data-testid="modal" className="flex max-h-[80dvh] flex-col">
          <div className="relative shrink-0 p-6 pr-14 pb-3">
            <DialogTitle data-testid="modal-title" className="title-2xl-semi-bold text-text-primary">
              {title}
            </DialogTitle>
            <DialogCloseButton className="top-5 right-5 h-8 w-8 rounded-lg" />
          </div>
          <div data-testid="modal-content" className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
            <div className="mb-2 system-sm-medium text-text-secondary">
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
                  <span aria-hidden="true" className="i-ri-information-2-fill h-5 w-5 shrink-0 text-text-accent" />
                </div>
                <div className="min-w-0 flex-1 text-text-secondary">
                  <div className="system-sm-regular leading-4 whitespace-pre-wrap">
                    {t('modal.oauthRedirectInfo', { ns: 'pluginTrigger' })}
                  </div>
                  <div className="my-1.5 system-sm-medium leading-4 break-all">
                    {oauthConfig?.redirect_uri}
                  </div>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={handleCopyRedirectUri}
                  >
                    <span aria-hidden="true" className="mr-1 i-ri-clipboard-line h-[14px] w-[14px]" />
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
          </div>
          <div data-testid="modal-footer" className="flex shrink-0 justify-between p-6 pt-5">
            <div>
              {showRemoveButton && (
                <Button
                  variant="secondary"
                  className="text-components-button-destructive-secondary-text"
                  onClick={handleRemove}
                >
                  {t('operation.remove', { ns: 'common' })}
                </Button>
              )}
            </div>
            <div className="flex items-center">
              <Button
                data-testid="modal-extra"
                variant="secondary"
                onClick={closeModal}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <div className="mx-3 h-4 w-px bg-divider-regular"></div>
              <Button
                data-testid="modal-cancel"
                onClick={() => handleSave(false)}
              >
                {t('auth.saveOnly', { ns: 'plugin' })}
              </Button>
              <Button
                data-testid="modal-confirm"
                className="ml-2"
                variant="primary"
                onClick={() => handleSave(true)}
              >
                {confirmButtonText}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
