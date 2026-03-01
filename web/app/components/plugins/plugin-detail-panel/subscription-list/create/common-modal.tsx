'use client'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import Modal from '@/app/components/base/modal/modal'
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

  return (
    <Modal
      title={t(MODAL_TITLE_KEY_MAP[createType], { ns: 'pluginTrigger' })}
      confirmButtonText={confirmButtonText}
      onClose={onClose}
      onCancel={onClose}
      onConfirm={handleConfirm}
      disabled={isVerifyingCredentials || isBuilding}
      bottomSlot={isVerifyStep ? <EncryptedBottom /> : null}
      size={createType === SupportedCreationMethods.MANUAL ? 'md' : 'sm'}
      containerClassName="min-h-[360px]"
      clickOutsideNotClose
    >
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
    </Modal>
  )
}
