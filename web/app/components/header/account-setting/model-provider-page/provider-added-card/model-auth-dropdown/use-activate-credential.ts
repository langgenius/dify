import type { Credential, ModelProvider } from '../../declarations'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { useActiveProviderCredential } from '@/service/use-models'
import {
  useUpdateModelList,
  useUpdateModelProviders,
} from '../../hooks'

export function useActivateCredential(provider: ModelProvider) {
  const { t } = useTranslation()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { mutate, isPending } = useActiveProviderCredential(provider.provider)
  const [optimisticId, setOptimisticId] = useState<string>()

  const currentId = provider.custom_configuration.current_credential_id
  const selectedCredentialId = optimisticId ?? currentId

  const selectedIdRef = useRef(selectedCredentialId)
  selectedIdRef.current = selectedCredentialId

  const supportedModelTypesRef = useRef(provider.supported_model_types)
  supportedModelTypesRef.current = provider.supported_model_types

  const activate = useCallback((credential: Credential) => {
    if (credential.credential_id === selectedIdRef.current)
      return
    setOptimisticId(credential.credential_id)
    mutate(
      { credential_id: credential.credential_id },
      {
        onSuccess: () => {
          Toast.notify({ type: 'success', message: t('api.actionSuccess', { ns: 'common' }) })
          updateModelProviders()
          supportedModelTypesRef.current.forEach(type => updateModelList(type))
        },
        onError: () => {
          setOptimisticId(undefined)
          Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
        },
      },
    )
  }, [mutate, t, updateModelProviders, updateModelList])

  return {
    selectedCredentialId,
    isActivating: isPending,
    activate,
  }
}
