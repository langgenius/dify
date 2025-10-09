import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import { useAuthService } from './use-auth-service'
import type {
  ConfigurationMethodEnum,
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelModalModeEnum,
  ModelProvider,
} from '../../declarations'
import {
  useModelModalHandler,
  useRefreshModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useDeleteModel } from '@/service/use-models'

export const useAuth = (
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  extra: {
    isModelCredential?: boolean,
    onUpdate?: (newPayload?: any, formValues?: Record<string, any>) => void,
    onRemove?: (credentialId: string) => void,
    mode?: ModelModalModeEnum,
  } = {},
) => {
  const {
    isModelCredential,
    onUpdate,
    onRemove,
    mode,
  } = extra
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const {
    getDeleteCredentialService,
    getActiveCredentialService,
    getEditCredentialService,
    getAddCredentialService,
  } = useAuthService(provider.provider)
  const { mutateAsync: deleteModelService } = useDeleteModel(provider.provider)
  const handleOpenModelModal = useModelModalHandler()
  const { handleRefreshModel } = useRefreshModel()
  const pendingOperationCredentialId = useRef<string | null>(null)
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const handleSetDeleteCredentialId = useCallback((credentialId: string | null) => {
    setDeleteCredentialId(credentialId)
    pendingOperationCredentialId.current = credentialId
  }, [])
  const pendingOperationModel = useRef<CustomModel | null>(null)
  const [deleteModel, setDeleteModel] = useState<CustomModel | null>(null)
  const handleSetDeleteModel = useCallback((model: CustomModel | null) => {
    setDeleteModel(model)
    pendingOperationModel.current = model
  }, [])
  const openConfirmDelete = useCallback((credential?: Credential, model?: CustomModel) => {
    if (credential)
      handleSetDeleteCredentialId(credential.credential_id)
    if (model)
      handleSetDeleteModel(model)
  }, [])
  const closeConfirmDelete = useCallback(() => {
    handleSetDeleteCredentialId(null)
    handleSetDeleteModel(null)
  }, [])
  const [doingAction, setDoingAction] = useState(false)
  const doingActionRef = useRef(doingAction)
  const handleSetDoingAction = useCallback((doing: boolean) => {
    doingActionRef.current = doing
    setDoingAction(doing)
  }, [])
  const handleActiveCredential = useCallback(async (credential: Credential, model?: CustomModel) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)
      await getActiveCredentialService(!!model)({
        credential_id: credential.credential_id,
        model: model?.model,
        model_type: model?.model_type,
      })
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      handleRefreshModel(provider, undefined, true)
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [getActiveCredentialService, notify, t, handleSetDoingAction])
  const handleConfirmDelete = useCallback(async () => {
    if (doingActionRef.current)
      return
    if (!pendingOperationCredentialId.current && !pendingOperationModel.current) {
      closeConfirmDelete()
      return
    }
    try {
      handleSetDoingAction(true)
      let payload: any = {}
      if (pendingOperationCredentialId.current) {
        payload = {
          credential_id: pendingOperationCredentialId.current,
          model: pendingOperationModel.current?.model,
          model_type: pendingOperationModel.current?.model_type,
        }
        await getDeleteCredentialService(!!isModelCredential)(payload)
      }
      if (!pendingOperationCredentialId.current && pendingOperationModel.current) {
        payload = {
          model: pendingOperationModel.current.model,
          model_type: pendingOperationModel.current.model_type,
        }
        await deleteModelService(payload)
      }
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      handleRefreshModel(provider, undefined, true)
      onRemove?.(pendingOperationCredentialId.current ?? '')
      closeConfirmDelete()
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [notify, t, handleSetDoingAction, getDeleteCredentialService, isModelCredential, closeConfirmDelete, handleRefreshModel, provider, configurationMethod, deleteModelService])
  const handleSaveCredential = useCallback(async (payload: Record<string, any>) => {
    if (doingActionRef.current)
      return
    try {
      handleSetDoingAction(true)

      let res: { result?: string } = {}
      if (payload.credential_id)
        res = await getEditCredentialService(!!isModelCredential)(payload as any)
      else
        res = await getAddCredentialService(!!isModelCredential)(payload as any)

      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        handleRefreshModel(provider, undefined, !payload.credential_id)
      }
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [notify, t, handleSetDoingAction, getEditCredentialService, getAddCredentialService])
  const handleOpenModal = useCallback((credential?: Credential, model?: CustomModel) => {
    handleOpenModelModal(
      provider,
      configurationMethod,
      currentCustomConfigurationModelFixedFields,
      {
        isModelCredential,
        credential,
        model,
        onUpdate,
        mode,
      },
    )
  }, [
    handleOpenModelModal,
    provider,
    configurationMethod,
    currentCustomConfigurationModelFixedFields,
    isModelCredential,
    onUpdate,
    mode,
  ])

  return {
    pendingOperationCredentialId,
    pendingOperationModel,
    openConfirmDelete,
    closeConfirmDelete,
    doingAction,
    handleActiveCredential,
    handleConfirmDelete,
    deleteCredentialId,
    deleteModel,
    handleSaveCredential,
    handleOpenModal,
  }
}
