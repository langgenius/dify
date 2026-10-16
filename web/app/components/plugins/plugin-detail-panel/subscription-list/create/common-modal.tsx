'use client'
import type { TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom, EncryptedFooter } from '@/app/components/base/encrypted-bottom'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { ConfigurationStepContent, MultiSteps, VerifyStepContent } from './components/modal-steps'
import {
  ApiKeyStep,
  MODAL_TITLE_KEY_MAP,
  useCommonModalState,
} from './hooks/use-common-modal-state'

type Props = Readonly<{
  open?: boolean
  onClose: () => void
  createType: SupportedCreationMethods
  builder?: TriggerSubscriptionBuilder
}>

export const CommonCreateModal = ({ open = true, onClose, createType, builder }: Props) => {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} disablePointerDismissal>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className={cn(
          'max-h-[80%] min-h-90',
          createType === SupportedCreationMethods.MANUAL && 'w-160',
        )}
      >
        <CommonCreateModalContent createType={createType} builder={builder} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function CommonCreateModalContent({ onClose, createType, builder }: Omit<Props, 'open'>) {
  const { t } = useTranslation(['common', 'pluginTrigger'])

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

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $[MODAL_TITLE_KEY_MAP[createType]], { ns: 'pluginTrigger' })}
        </DialogTitle>
        <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>

      <DialogBody>
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
      </DialogBody>

      <EncryptedFooter>
        <DialogFooter>
          <Button disabled={isDisabled} onClick={onClose}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            disabled={isDisabled}
            data-testid="modal-confirm"
            onClick={handleConfirm}
          >
            {confirmButtonText}
          </Button>
        </DialogFooter>
        {isVerifyStep && <EncryptedBottom />}
      </EncryptedFooter>
    </>
  )
}
