'use client'

import { createContext, useContext } from 'use-context-selector'
import useSWR from 'swr'
import { mockTextGenerationModelList } from './provider-mock'
import { fetchModelList, fetchTenantInfo } from '@/service/common'
import { ModelFeature, ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import type { BackendModel } from '@/app/components/header/account-setting/model-page/declarations'
const ProviderContext = createContext<{
  currentProvider: {
    provider: string
    provider_name: string
    token_is_set: boolean
    is_valid: boolean
    token_is_valid: boolean
  } | null | undefined
  textGenerationModelList: BackendModel[]
  embeddingsModelList: BackendModel[]
  speech2textModelList: BackendModel[]
  agentThoughtModelList: BackendModel[]
}>({
  currentProvider: null,
  textGenerationModelList: [],
  embeddingsModelList: [],
  speech2textModelList: [],
  agentThoughtModelList: [],
})

export const useProviderContext = () => useContext(ProviderContext)

type ProviderContextProviderProps = {
  children: React.ReactNode
}
export const ProviderContextProvider = ({
  children,
}: ProviderContextProviderProps) => {
  const { data: userInfo } = useSWR({ url: '/info' }, fetchTenantInfo)
  const currentProvider = userInfo?.providers?.find(({ token_is_set, is_valid, provider_name }) => token_is_set && is_valid && (provider_name === 'openai' || provider_name === 'azure_openai'))
  const fetchModelListUrlPrefix = '/workspaces/current/models/model-type/'
  const { data: textGenerationModelListRes } = useSWR(`${fetchModelListUrlPrefix}${ModelType.textGeneration}`, fetchModelList)
  const { data: embeddingsModelListRes } = useSWR(`${fetchModelListUrlPrefix}${ModelType.embeddings}`, fetchModelList)
  const { data: speech2textModelListRes } = useSWR(`${fetchModelListUrlPrefix}${ModelType.speech2text}`, fetchModelList)

  const agentThoughtModelList = speech2textModelListRes?.data?.filter(item => item.features?.includes(ModelFeature.agentThought))
  return (
    <ProviderContext.Provider value={{
      currentProvider,
      textGenerationModelList: textGenerationModelListRes?.data || (mockTextGenerationModelList as BackendModel[]),
      embeddingsModelList: embeddingsModelListRes?.data || [],
      speech2textModelList: speech2textModelListRes?.data || [],
      agentThoughtModelList: agentThoughtModelList || [],
    }}>
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
