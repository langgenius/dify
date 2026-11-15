import type {
  ModelProviderSummaryResponse,
  ProviderModelWithStatusEntity,
  ProviderWithModelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { deriveModelStatus } from '@/app/components/header/account-setting/model-provider-page/derive-model-status'
import { useCredentialPanelState } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state'
import { consoleQuery } from '@/service/console'

type UseEmbeddingModelStatusProps = {
  embeddingModel?: string
  embeddingModelProvider?: string
  embeddingModelList: ProviderWithModelsResponse[]
}

type UseEmbeddingModelStatusResult = {
  providerMeta: ModelProviderSummaryResponse | undefined
  modelProvider: ProviderWithModelsResponse | undefined
  currentModel: ProviderModelWithStatusEntity | undefined
  status: ReturnType<typeof deriveModelStatus>
}

export const useEmbeddingModelStatus = ({
  embeddingModel,
  embeddingModelProvider,
  embeddingModelList,
}: UseEmbeddingModelStatusProps): UseEmbeddingModelStatusResult => {
  const { data: providerMeta } = useQuery(
    consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions({
      select: (response) =>
        response.data.find((provider) => provider.provider === embeddingModelProvider),
    }),
  )

  const modelProvider = useMemo(() => {
    return embeddingModelList.find((provider) => provider.provider === embeddingModelProvider)
  }, [embeddingModelList, embeddingModelProvider])

  const currentModel = useMemo(() => {
    return modelProvider?.models.find((model) => model.model === embeddingModel)
  }, [embeddingModel, modelProvider])

  const credentialState = useCredentialPanelState(providerMeta)

  const status = useMemo(() => {
    return deriveModelStatus(
      embeddingModel,
      embeddingModelProvider,
      providerMeta,
      currentModel,
      credentialState,
    )
  }, [credentialState, currentModel, embeddingModel, embeddingModelProvider, providerMeta])

  return {
    providerMeta,
    modelProvider,
    currentModel,
    status,
  }
}
