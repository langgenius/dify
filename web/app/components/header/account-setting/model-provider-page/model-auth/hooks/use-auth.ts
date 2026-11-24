import type {
  ConfigurationMethodEnum,
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelModalModeEnum,
  ModelProvider,
} from '../../declarations'
import type { CredentialSaved } from '@/app/components/header/account-setting/model-provider-page/model-modal/handle'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRefreshModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { modelCredentialDialog } from '../../model-modal/handle'
import { useAuthService } from './use-auth-service'

type ProviderCredentialOperationPayload = {
  credential_id: string
}

type ModelCredentialOperationPayload = {
  credential_id: string
  model: string
  model_type: CustomModel['model_type']
}

export const useAuth = (
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  extra: {
    isModelCredential?: boolean
    onUpdate?: CredentialSaved
    onRemove?: (credentialId: string) => void
    mode?: ModelModalModeEnum
  } = {},
) => {
  const { isModelCredential, onUpdate, onRemove, mode } = extra
  const { t } = useTranslation(['common'])
  const {
    getDeleteCredentialService,
    getActiveCredentialService,
    getEditCredentialService,
    getAddCredentialService,
  } = useAuthService(provider.provider)
  const { mutateAsync: deleteModelService } = useMutation(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.delete.mutationOptions({
      networkMode: 'always',
    }),
  )
  const { handleRefreshModel } = useRefreshModel()
  const [deleteTarget, setDeleteTarget] = useState<{
    credential?: Credential
    model?: CustomModel
  } | null>(null)
  const deleteCredentialId = deleteTarget?.credential?.credential_id ?? null
  const deleteModel = deleteTarget?.model ?? null
  const resolveModelContext = useCallback(
    (model?: CustomModel | null): CustomModel | undefined => {
      if (model) return model

      if (!currentCustomConfigurationModelFixedFields) return undefined

      return {
        model: currentCustomConfigurationModelFixedFields.__model_name,
        model_type: currentCustomConfigurationModelFixedFields.__model_type,
      }
    },
    [currentCustomConfigurationModelFixedFields],
  )
  const openConfirmDelete = useCallback((credential?: Credential, model?: CustomModel) => {
    setDeleteTarget({ credential, model })
  }, [])
  const closeConfirmDelete = useCallback(() => setDeleteTarget(null), [])
  const [pendingAction, setPendingAction] = useState<'activate' | 'delete' | 'save' | null>(null)
  const doingActionRef = useRef(false)
  const handleSetPendingAction = useCallback((action: typeof pendingAction) => {
    doingActionRef.current = action !== null
    setPendingAction(action)
  }, [])
  const handleActiveCredential = useCallback(
    async (credential: Credential, model?: CustomModel) => {
      if (doingActionRef.current) return
      try {
        handleSetPendingAction('activate')
        const modelContext = model ?? (isModelCredential ? resolveModelContext() : undefined)
        if (modelContext) {
          const activeModelCredential = getActiveCredentialService(true) as (
            payload: ModelCredentialOperationPayload,
          ) => Promise<unknown>
          await activeModelCredential({
            credential_id: credential.credential_id,
            model: modelContext.model,
            model_type: modelContext.model_type,
          })
        } else {
          const activeProviderCredential = getActiveCredentialService(false) as (
            payload: ProviderCredentialOperationPayload,
          ) => Promise<unknown>
          await activeProviderCredential({
            credential_id: credential.credential_id,
          })
        }
        toast.success(t(($) => $['api.actionSuccess'], { ns: 'common' }))
        handleRefreshModel(provider, undefined, true)
      } finally {
        handleSetPendingAction(null)
      }
    },
    [
      getActiveCredentialService,
      isModelCredential,
      resolveModelContext,
      t,
      handleSetPendingAction,
      provider,
      handleRefreshModel,
    ],
  )
  const handleConfirmDelete = useCallback(async () => {
    if (doingActionRef.current) return
    if (!deleteCredentialId && !deleteModel) {
      closeConfirmDelete()
      return
    }
    try {
      handleSetPendingAction('delete')
      if (deleteCredentialId) {
        if (isModelCredential) {
          const modelContext = resolveModelContext(deleteModel)
          if (!modelContext) return

          const payload = {
            credential_id: deleteCredentialId,
            model: modelContext.model,
            model_type: modelContext.model_type,
          }
          const deleteModelCredential = getDeleteCredentialService(true) as (
            payload: ModelCredentialOperationPayload,
          ) => Promise<unknown>
          await deleteModelCredential(payload)
        } else {
          const payload = {
            credential_id: deleteCredentialId,
          }
          const deleteProviderCredential = getDeleteCredentialService(false) as (
            payload: ProviderCredentialOperationPayload,
          ) => Promise<unknown>
          await deleteProviderCredential(payload)
        }
      } else if (deleteModel) {
        const payload = {
          model: deleteModel.model,
          model_type: deleteModel.model_type,
        }
        await deleteModelService({ params: { provider: provider.provider }, query: payload })
      }
      handleRefreshModel(provider, undefined, true)
      onRemove?.(deleteCredentialId ?? '')
      closeConfirmDelete()
    } finally {
      handleSetPendingAction(null)
    }
  }, [
    handleSetPendingAction,
    getDeleteCredentialService,
    isModelCredential,
    closeConfirmDelete,
    handleRefreshModel,
    provider,
    deleteCredentialId,
    deleteModel,
    onRemove,
    deleteModelService,
    resolveModelContext,
  ])
  const handleSaveCredential = useCallback(
    async (payload: Record<string, any>) => {
      if (doingActionRef.current) return
      try {
        handleSetPendingAction('save')
        let res: {
          result?: string
        } = {}
        if (payload.credential_id)
          res = await getEditCredentialService(!!isModelCredential)(payload as any)
        else res = await getAddCredentialService(!!isModelCredential)(payload as any)
        if (res.result === 'success') {
          toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
          handleRefreshModel(provider, undefined, !payload.credential_id)
        }
      } finally {
        handleSetPendingAction(null)
      }
    },
    [
      t,
      handleSetPendingAction,
      getEditCredentialService,
      getAddCredentialService,
      provider,
      handleRefreshModel,
      isModelCredential,
    ],
  )
  const handleOpenModal = useCallback(
    (credential?: Credential, model?: CustomModel) => {
      modelCredentialDialog.openWithPayload({
        provider,
        configurateMethod: configurationMethod,
        currentCustomConfigurationModelFixedFields,
        isModelCredential,
        credential,
        model,
        onSave: onUpdate,
        mode,
      })
    },
    [
      provider,
      configurationMethod,
      currentCustomConfigurationModelFixedFields,
      isModelCredential,
      onUpdate,
      mode,
    ],
  )
  return {
    openConfirmDelete,
    closeConfirmDelete,
    doingAction: pendingAction !== null,
    isDeleting: pendingAction === 'delete',
    doingActionRef,
    handleActiveCredential,
    handleConfirmDelete,
    deleteCredentialId,
    deleteModel,
    handleSaveCredential,
    handleOpenModal,
  }
}
