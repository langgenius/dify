import type { Credential, ModelProvider } from '../../declarations'
import { useMutation } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

export function useActivateCredential(provider: ModelProvider) {
  const { t } = useTranslation(['common'])
  const { mutate, isPending } = useMutation(
    consoleQuery.workspaces.current.modelProviders.byProvider.credentials.switch.post.mutationOptions(
      { meta: { errorToast: false } },
    ),
  )
  const [optimisticId, setOptimisticId] = useState<string>()
  const currentId = provider.custom_configuration.current_credential_id
  const selectedCredentialId = optimisticId ?? currentId
  const selectedIdRef = useRef(selectedCredentialId)

  useEffect(() => {
    selectedIdRef.current = selectedCredentialId
  }, [selectedCredentialId])
  const activate = useCallback(
    (credential: Credential) => {
      if (credential.credential_id === selectedIdRef.current) return
      setOptimisticId(credential.credential_id)
      mutate(
        {
          params: { provider: provider.provider },
          body: { credential_id: credential.credential_id },
        },
        {
          onError: (error) => {
            setOptimisticId(undefined)
            toast.error(
              getErrorMessage(error) ??
                t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
            )
          },
        },
      )
    },
    [mutate, provider.provider, t],
  )
  return {
    selectedCredentialId,
    isActivating: isPending,
    activate,
  }
}
