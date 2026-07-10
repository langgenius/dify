import type { Credential, ModelProvider, PreferredProviderTypeEnum } from '../../declarations'
import type { CredentialPanelState } from '../use-credential-panel-state'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { ConfigurationMethodEnum } from '../../declarations'
import { useAuth } from '../../model-auth/hooks'
import ApiKeySection from './api-key-section'
import CreditsExhaustedAlert from './credits-exhausted-alert'
import CreditsFallbackAlert from './credits-fallback-alert'
import UsagePrioritySection from './usage-priority-section'
import { useActivateCredential } from './use-activate-credential'

const EMPTY_CREDENTIALS: Credential[] = []

type DropdownContentProps = {
  provider: ModelProvider
  state: CredentialPanelState
  isChangingPriority: boolean
  onChangePriority: (key: PreferredProviderTypeEnum) => void
  onClose: () => void
}

function DropdownContent({
  provider,
  state,
  isChangingPriority,
  onChangePriority,
  onClose,
}: DropdownContentProps) {
  const { t } = useTranslation()
  const { available_credentials } = provider.custom_configuration
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()

  const {
    openConfirmDelete,
    closeConfirmDelete,
    doingAction,
    handleConfirmDelete,
    deleteCredentialId,
    handleOpenModal,
  } = useAuth(provider, ConfigurationMethodEnum.predefinedModel)

  const { selectedCredentialId, isActivating, activate } = useActivateCredential(provider)

  const handleEdit = useCallback((credential?: Credential) => {
    if (credential ? !canManageCredential : !canCreateCredential)
      return

    handleOpenModal(credential)
    onClose()
  }, [canCreateCredential, canManageCredential, handleOpenModal, onClose])

  const handleDelete = useCallback((credential?: Credential) => {
    if (!canManageCredential)
      return

    if (credential)
      openConfirmDelete(credential)
  }, [canManageCredential, openConfirmDelete])

  const handleAdd = useCallback(() => {
    if (!canCreateCredential)
      return

    handleOpenModal()
    onClose()
  }, [canCreateCredential, handleOpenModal, onClose])

  const showCreditsExhaustedAlert = state.isCreditsExhausted && state.supportsCredits
  const hasApiKeyFallback = state.variant === 'api-fallback'
    || (state.variant === 'api-active' && state.priority === 'apiKey')
  const showCreditsFallbackAlert = state.priority === 'apiKey'
    && state.supportsCredits
    && !state.isCreditsExhausted
    && state.variant !== 'api-active'

  return (
    <>
      <div className="w-[320px]">
        {state.showPrioritySwitcher && (
          <UsagePrioritySection
            value={state.priority}
            disabled={isChangingPriority || !canUseCredential}
            onSelect={onChangePriority}
          />
        )}
        {showCreditsFallbackAlert && (
          <CreditsFallbackAlert hasCredentials={state.hasCredentials} />
        )}
        {showCreditsExhaustedAlert && (
          <CreditsExhaustedAlert hasApiKeyFallback={hasApiKeyFallback} />
        )}
        <ApiKeySection
          provider={provider}
          credentials={available_credentials ?? EMPTY_CREDENTIALS}
          selectedCredentialId={selectedCredentialId}
          isActivating={isActivating}
          onItemClick={activate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onAdd={handleAdd}
        />
      </div>
      <AlertDialog
        open={!!deleteCredentialId}
        onOpenChange={(open) => {
          if (!open)
            closeConfirmDelete()
        }}
      >
        <AlertDialogContent>
          <div className="p-6 pb-0">
            <AlertDialogTitle className="system-xl-semibold text-text-primary">
              {t($ => $['modelProvider.confirmDelete'], { ns: 'common' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-1 system-sm-regular text-text-secondary" />
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={doingAction}>
              {t($ => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={doingAction} onClick={handleConfirmDelete}>
              {t($ => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default memo(DropdownContent)
