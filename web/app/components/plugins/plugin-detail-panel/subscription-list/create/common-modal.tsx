'use client'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import {
  ConfigurationStepContent,
  MultiSteps,
  VerifyStepContent,
} from './components/modal-steps'
import {
  ApiKeyStep,
  MODAL_TITLE_KEY_MAP,
  useCommonModalState,
} from './hooks/use-common-modal-state'

type Props = {
  onClose: () => void
  createType: SupportedCreationMethods
  builder?: TriggerSubscriptionBuilder
}

export const CommonCreateModal = ({ onClose, createType, builder }: Props) => {
  const { t } = useTranslation()

  const {
    currentStep,
    subscriptionBuilder,
    isVerifyingCredentials,
    isBuilding,
    formRefs,
    detail,
    manualPropertiesSchema,
    autoCommonParametersSchema,
    apiKeyCredentialsSchema,
    logData,
    confirmButtonText,
    handleConfirm,
    handleManualPropertiesChange,
    handleApiKeyCredentialsChange,
  } = useCommonModalState({
    createType,
    builder,
    onClose,
  })

  const isApiKeyType = createType === SupportedCreationMethods.APIKEY
  const isVerifyStep = currentStep === ApiKeyStep.Verify
  const isConfigurationStep = currentStep === ApiKeyStep.Configuration
  const isDisabled = isVerifyingCredentials || isBuilding
  const modalSize = createType === SupportedCreationMethods.MANUAL ? 'md' : 'sm'

  return (
    <Dialog open disablePointerDismissal>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className={cn(
          'flex max-h-[80%] min-h-[360px] flex-col overflow-hidden p-0 shadow-xs',
          modalSize === 'md'
            ? 'w-[640px] max-w-[calc(100vw-2rem)]'
            : 'w-[480px] max-w-[calc(100vw-2rem)]',
        )}
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-testid="modal"
          data-size={modalSize}
          data-disabled={isDisabled}
        >
          <div className="relative shrink-0 p-6 pr-14 pb-3">
            <DialogTitle className="title-2xl-semi-bold text-text-primary" data-testid="modal-title">
              {t(MODAL_TITLE_KEY_MAP[createType], { ns: 'pluginTrigger' })}
            </DialogTitle>
            <DialogCloseButton
              className="top-5 right-5 h-8 w-8 rounded-lg [&>span]:h-5 [&>span]:w-5"
              data-testid="modal-close"
              onClick={onClose}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
            {isApiKeyType && <MultiSteps currentStep={currentStep} />}

            {isVerifyStep && (
              <VerifyStepContent
                apiKeyCredentialsSchema={apiKeyCredentialsSchema}
                apiKeyCredentialsFormRef={formRefs.apiKeyCredentialsFormRef}
                onChange={handleApiKeyCredentialsChange}
              />
            )}

            {isConfigurationStep && (
              <ConfigurationStepContent
                createType={createType}
                subscriptionBuilder={subscriptionBuilder}
                subscriptionFormRef={formRefs.subscriptionFormRef}
                autoCommonParametersSchema={autoCommonParametersSchema}
                autoCommonParametersFormRef={formRefs.autoCommonParametersFormRef}
                manualPropertiesSchema={manualPropertiesSchema}
                manualPropertiesFormRef={formRefs.manualPropertiesFormRef}
                onManualPropertiesChange={handleManualPropertiesChange}
                logs={logData?.logs || []}
                pluginId={detail?.plugin_id || ''}
                pluginName={detail?.name || ''}
                provider={detail?.provider || ''}
              />
            )}
          </div>

          <div className="flex shrink-0 justify-end p-6 pt-5">
            <div className="flex items-center">
              <Button
                disabled={isDisabled}
                onClick={onClose}
              >
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                className="ml-2"
                variant="primary"
                disabled={isDisabled}
                data-testid="modal-confirm"
                onClick={handleConfirm}
              >
                {confirmButtonText}
              </Button>
            </div>
          </div>

          {isVerifyStep && (
            <div className="shrink-0">
              <EncryptedBottom />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
