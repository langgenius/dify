'use client'

import { createContext, useContext } from 'use-context-selector'
import useSWR from 'swr'
import { fetchDefaultModal, fetchModelList, fetchSupportRetrievalMethods } from '@/service/common'
import { ModelFeature, ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import type { BackendModel } from '@/app/components/header/account-setting/model-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
const ProviderContext = createContext<{
  textGenerationModelList: BackendModel[]
  embeddingsModelList: BackendModel[]
  speech2textModelList: BackendModel[]
  rerankModelList: BackendModel[]
  agentThoughtModelList: BackendModel[]
  updateModelList: (type: ModelType) => void
  textGenerationDefaultModel?: BackendModel
  mutateTextGenerationDefaultModel: () => void
  embeddingsDefaultModel?: BackendModel
  mutateEmbeddingsDefaultModel: () => void
  speech2textDefaultModel?: BackendModel
  mutateSpeech2textDefaultModel: () => void
  rerankDefaultModel?: BackendModel
  isRerankDefaultModelVaild: boolean
  mutateRerankDefaultModel: () => void
  supportRetrievalMethods: RETRIEVE_METHOD[]
}>({
      textGenerationModelList: [],
      embeddingsModelList: [],
      speech2textModelList: [],
      rerankModelList: [],
      agentThoughtModelList: [],
      updateModelList: () => {},
      textGenerationDefaultModel: undefined,
      mutateTextGenerationDefaultModel: () => {},
      speech2textDefaultModel: undefined,
      mutateSpeech2textDefaultModel: () => {},
      embeddingsDefaultModel: undefined,
      mutateEmbeddingsDefaultModel: () => {},
      rerankDefaultModel: undefined,
      isRerankDefaultModelVaild: false,
      mutateRerankDefaultModel: () => {},
      supportRetrievalMethods: [],
    })

export const useProviderContext = () => useContext(ProviderContext)

type ProviderContextProviderProps = {
  children: React.ReactNode
}
export const ProviderContextProvider = ({
  children,
}: ProviderContextProviderProps) => {
  const { data: textGenerationDefaultModel, mutate: mutateTextGenerationDefaultModel } = useSWR('/workspaces/current/default-model?model_type=text-generation', fetchDefaultModal)
  const { data: embeddingsDefaultModel, mutate: mutateEmbeddingsDefaultModel } = useSWR('/workspaces/current/default-model?model_type=embeddings', fetchDefaultModal)
  const { data: speech2textDefaultModel, mutate: mutateSpeech2textDefaultModel } = useSWR('/workspaces/current/default-model?model_type=speech2text', fetchDefaultModal)
  const { data: rerankDefaultModel, mutate: mutateRerankDefaultModel } = useSWR('/workspaces/current/default-model?model_type=reranking', fetchDefaultModal)
  const fetchModelListUrlPrefix = '/workspaces/current/models/model-type/'
  const { data: textGenerationModelList, mutate: mutateTextGenerationModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelType.textGeneration}`, fetchModelList)
  const { data: embeddingsModelList, mutate: mutateEmbeddingsModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelType.embeddings}`, fetchModelList)
  const { data: speech2textModelList, mutate: mutateSpeech2textModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelType.speech2text}`, fetchModelList)
  const { data: rerankModelList, mutate: mutateRerankModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelType.reranking}`, fetchModelList)
  const { data: supportRetrievalMethods } = useSWR('/datasets/retrieval-setting', fetchSupportRetrievalMethods)

  const agentThoughtModelList = textGenerationModelList?.filter((item) => {
    return item.features?.includes(ModelFeature.agentThought)
  })

  const isRerankDefaultModelVaild = !!rerankModelList?.find(
    item => item.model_name === rerankDefaultModel?.model_name && item.model_provider.provider_name === rerankDefaultModel?.model_provider.provider_name,
  )

  const updateModelList = (type: ModelType) => {
    if (type === ModelType.textGeneration)
      mutateTextGenerationModelList()
    if (type === ModelType.embeddings)
      mutateEmbeddingsModelList()
    if (type === ModelType.speech2text)
      mutateSpeech2textModelList()
    if (type === ModelType.reranking)
      mutateRerankModelList()
  }

  return (
    <ProviderContext.Provider value={{
      textGenerationModelList: textGenerationModelList || [],
      embeddingsModelList: embeddingsModelList || [],
      speech2textModelList: speech2textModelList || [],
      rerankModelList: rerankModelList || [],
      agentThoughtModelList: agentThoughtModelList || [],
      updateModelList,
      textGenerationDefaultModel,
      mutateTextGenerationDefaultModel,
      embeddingsDefaultModel,
      mutateEmbeddingsDefaultModel,
      speech2textDefaultModel,
      mutateSpeech2textDefaultModel,
      rerankDefaultModel,
      isRerankDefaultModelVaild,
      mutateRerankDefaultModel,
      supportRetrievalMethods: supportRetrievalMethods?.retrieval_method || [],
    }}>
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
