import type {
  Model,
  ModelItem,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useMemo } from 'react'
import { deriveModelStatus } from '@/app/components/header/account-setting/model-provider-page/derive-model-status'
import { useCredentialPanelState } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state'
import { useProviderContext } from '@/context/provider-context'

type UseEmbeddingModelStatusProps = {
  embeddingModel?: string
  embeddingModelProvider?: string
  embeddingModelList: Model[]
}

type UseEmbeddingModelStatusResult = {
  providerMeta: ModelProvider | undefined
  modelProvider: Model | undefined
  currentModel: ModelItem | undefined
  status: ReturnType<typeof deriveModelStatus>
}

export const useEmbeddingModelStatus = ({
  embeddingModel,
  embeddingModelProvider,
  embeddingModelList,
}: UseEmbeddingModelStatusProps): UseEmbeddingModelStatusResult => {
  const { modelProviders } = useProviderContext()

  const providerMeta = useMemo(() => {
    return modelProviders.find(provider => provider.provider === embeddingModelProvider)
  }, [embeddingModelProvider, modelProviders])

  const modelProvider = useMemo(() => {
    return embeddingModelList.find(provider => provider.provider === embeddingModelProvider)
  }, [embeddingModelList, embeddingModelProvider])

  const currentModel = useMemo(() => {
    return modelProvider?.models.find(model => model.model === embeddingModel)
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
