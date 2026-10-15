import type { Credential, ModelProvider } from '../../declarations'
import { safe } from '@orpc/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useActiveProviderCredential } from '@/service/use-models'
import { useUpdateModelList, useUpdateModelProviders } from '../../hooks'

export function useActivateCredential(provider: ModelProvider) {
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { mutateAsync, isPending } = useActiveProviderCredential(provider.provider)
  const [optimisticId, setOptimisticId] = useState<string>()
  const currentId = provider.custom_configuration.current_credential_id
  const selectedCredentialId = optimisticId ?? currentId
  const selectedIdRef = useRef(selectedCredentialId)
  const supportedModelTypesRef = useRef(provider.supported_model_types)

  useEffect(() => {
    selectedIdRef.current = selectedCredentialId
    supportedModelTypesRef.current = provider.supported_model_types
  }, [selectedCredentialId, provider.supported_model_types])
  const activate = useCallback(
    async (credential: Credential) => {
      if (credential.credential_id === selectedIdRef.current) return
      setOptimisticId(credential.credential_id)
      const [error] = await safe(mutateAsync({ credential_id: credential.credential_id }))
      if (error) {
        setOptimisticId(undefined)
        return
      }
      updateModelProviders()
      supportedModelTypesRef.current.forEach((type) => updateModelList(type))
    },
    [mutateAsync, updateModelProviders, updateModelList],
  )
  return {
    selectedCredentialId,
    isActivating: isPending,
    activate,
  }
}
