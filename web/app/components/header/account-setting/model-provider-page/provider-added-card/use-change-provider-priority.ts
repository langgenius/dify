import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ModelProvider, PreferredProviderTypeEnum } from '../declarations'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

export function useChangeProviderPriority(
  provider: ModelProvider | ModelProviderSummaryResponse | undefined,
) {
  const { t } = useTranslation(['common'])
  const providerName = provider?.provider ?? ''
  const { mutate: changePriority, isPending: isChangingPriority } = useMutation(
    consoleQuery.workspaces.current.modelProviders.byProvider.preferredProviderType.post.mutationOptions(
      {
        meta: { errorToast: false },
        onError: (error) => {
          toast.error(
            getErrorMessage(error) ??
              t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
          )
        },
      },
    ),
  )
  const handleChangePriority = (key: PreferredProviderTypeEnum) => {
    if (!providerName) return
    changePriority({
      params: { provider: providerName },
      body: { preferred_provider_type: key },
    })
  }
  return { isChangingPriority, handleChangePriority }
}
