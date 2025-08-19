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
  ModelProvider,
} from '../../declarations'
import {
  useModelModalHandler,
  useRefreshModel,
} from '@/app/components/header/account-setting/model-provider-page/hooks'

export const useAuth = (
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  isModelCredential?: boolean,
  onUpdate?: () => void,
) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const {
    getDeleteCredentialService,
    getActiveCredentialService,
    getEditCredentialService,
    getAddCredentialService,
  } = useAuthService(provider.provider)
  const handleOpenModelModal = useModelModalHandler()
  const { handleRefreshModel } = useRefreshModel()
  const pendingOperationCredentialId = useRef<string | null>(null)
  const pendingOperationModel = useRef<CustomModel | null>(null)
  const [deleteCredentialId, setDeleteCredentialId] = useState<string | null>(null)
  const openConfirmDelete = useCallback((credential?: Credential, model?: CustomModel) => {
    if (credential)
      pendingOperationCredentialId.current = credential.credential_id
    if (model)
      pendingOperationModel.current = model

    setDeleteCredentialId(pendingOperationCredentialId.current)
  }, [])
  const closeConfirmDelete = useCallback(() => {
    setDeleteCredentialId(null)
    pendingOperationCredentialId.current = null
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
      onUpdate?.()
      handleRefreshModel(provider, configurationMethod, undefined)
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [getActiveCredentialService, onUpdate, notify, t, handleSetDoingAction])
  const handleConfirmDelete = useCallback(async () => {
    if (doingActionRef.current)
      return
    if (!pendingOperationCredentialId.current) {
      setDeleteCredentialId(null)
      return
    }
    try {
      handleSetDoingAction(true)
      await getDeleteCredentialService(!!isModelCredential)({
        credential_id: pendingOperationCredentialId.current,
        model: pendingOperationModel.current?.model,
        model_type: pendingOperationModel.current?.model_type,
      })
      notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      onUpdate?.()
      handleRefreshModel(provider, configurationMethod, undefined)
      setDeleteCredentialId(null)
      pendingOperationCredentialId.current = null
      pendingOperationModel.current = null
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [onUpdate, notify, t, handleSetDoingAction, getDeleteCredentialService, isModelCredential])
  const handleAddCredential = useCallback((model?: CustomModel) => {
    if (model)
      pendingOperationModel.current = model
  }, [])
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
        onUpdate?.()
      }
    }
    finally {
      handleSetDoingAction(false)
    }
  }, [onUpdate, notify, t, handleSetDoingAction, getEditCredentialService, getAddCredentialService])
  const handleOpenModal = useCallback((credential?: Credential, model?: CustomModel) => {
    handleOpenModelModal(
      provider,
      configurationMethod,
      currentCustomConfigurationModelFixedFields,
      isModelCredential,
      credential,
      model,
      onUpdate,
    )
  }, [handleOpenModelModal, provider, configurationMethod, currentCustomConfigurationModelFixedFields, isModelCredential, onUpdate])

  return {
    pendingOperationCredentialId,
    pendingOperationModel,
    openConfirmDelete,
    closeConfirmDelete,
    doingAction,
    handleActiveCredential,
    handleConfirmDelete,
    handleAddCredential,
    deleteCredentialId,
    handleSaveCredential,
    handleOpenModal,
  }
}
