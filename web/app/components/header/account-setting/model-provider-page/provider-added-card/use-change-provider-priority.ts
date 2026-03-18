import type { ModelProvider, PreferredProviderTypeEnum } from '../declarations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { consoleQuery } from '@/service/client'
import { ConfigurationMethodEnum } from '../declarations'
import { useUpdateModelList, useUpdateModelProviders } from '../hooks'

export function useChangeProviderPriority(provider: ModelProvider | undefined) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const providerName = provider?.provider ?? ''

  const modelProviderModelListQueryKey = consoleQuery.modelProviders.models.queryKey({
    input: {
      params: {
        provider: providerName,
      },
    },
  })

  const { mutate: changePriority, isPending: isChangingPriority } = useMutation(
    consoleQuery.modelProviders.changePreferredProviderType.mutationOptions({
      onSuccess: () => {
        Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        queryClient.invalidateQueries({
          queryKey: modelProviderModelListQueryKey,
          exact: true,
          refetchType: 'none',
        })
        updateModelProviders()
        provider?.configurate_methods.forEach((method) => {
          if (method === ConfigurationMethodEnum.predefinedModel)
            provider?.supported_model_types.forEach(modelType => updateModelList(modelType))
        })
      },
      onError: () => {
        Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
      },
    }),
  )

  const handleChangePriority = (key: PreferredProviderTypeEnum) => {
    changePriority({
      params: { provider: providerName },
      body: { preferred_provider_type: key },
    })
  }

  return { isChangingPriority, handleChangePriority }
}
