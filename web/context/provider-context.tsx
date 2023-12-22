'use client'

import { createContext, useContext } from 'use-context-selector'
import useSWR from 'swr'
import { useEffect, useState } from 'react'
import { fetchDefaultModal, fetchModelList, fetchSupportRetrievalMethods } from '@/service/common'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type {
  DefaultModelResponse,
  Model,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import { Plan, type UsagePlanInfo } from '@/app/components/billing/type'
import { fetchCurrentPlanInfo } from '@/service/billing'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import { defaultPlan } from '@/app/components/billing/config'

const ProviderContext = createContext<{
  textGenerationModelList: Model[]
  embeddingsModelList: Model[]
  speech2textModelList: Model[]
  rerankModelList: Model[]
  moderationModelList: Model[]
  agentThoughtModelList: Model[]
  updateModelList: (type: ModelTypeEnum) => void
  textGenerationDefaultModel?: DefaultModelResponse
  mutateTextGenerationDefaultModel: () => void
  embeddingsDefaultModel?: DefaultModelResponse
  isEmbeddingsDefaultModelValid: boolean
  mutateEmbeddingsDefaultModel: () => void
  speech2textDefaultModel?: DefaultModelResponse
  mutateSpeech2textDefaultModel: () => void
  rerankDefaultModel?: DefaultModelResponse
  isRerankDefaultModelVaild: boolean
  mutateRerankDefaultModel: () => void
  moderationDefaultModel?: DefaultModelResponse
  mutateModerationDefaultModel: () => void
  supportRetrievalMethods: RETRIEVE_METHOD[]
  hasSettedApiKey: boolean
  plan: {
    type: Plan
    usage: UsagePlanInfo
    total: UsagePlanInfo
  }
  isFetchedPlan: boolean
  enableBilling: boolean
  enableReplaceWebAppLogo: boolean
}>({
      textGenerationModelList: [],
      embeddingsModelList: [],
      speech2textModelList: [],
      rerankModelList: [],
      moderationModelList: [],
      agentThoughtModelList: [],
      updateModelList: () => { },
      textGenerationDefaultModel: undefined,
      mutateTextGenerationDefaultModel: () => { },
      speech2textDefaultModel: undefined,
      mutateSpeech2textDefaultModel: () => { },
      embeddingsDefaultModel: undefined,
      isEmbeddingsDefaultModelValid: false,
      mutateEmbeddingsDefaultModel: () => { },
      rerankDefaultModel: undefined,
      isRerankDefaultModelVaild: false,
      mutateRerankDefaultModel: () => { },
      moderationDefaultModel: undefined,
      mutateModerationDefaultModel: () => {},
      supportRetrievalMethods: [],
      hasSettedApiKey: false,
      plan: {
        type: Plan.sandbox,
        usage: {
          vectorSpace: 32,
          buildApps: 12,
          teamMembers: 1,
          annotatedResponse: 1,
        },
        total: {
          vectorSpace: 200,
          buildApps: 50,
          teamMembers: 1,
          annotatedResponse: 10,
        },
      },
      isFetchedPlan: false,
      enableBilling: false,
      enableReplaceWebAppLogo: false,
    })

export const useProviderContext = () => useContext(ProviderContext)

type ProviderContextProviderProps = {
  children: React.ReactNode
}
export const ProviderContextProvider = ({
  children,
}: ProviderContextProviderProps) => {
  const { data: textGenerationDefaultModel, mutate: mutateTextGenerationDefaultModel } = useSWR(`/workspaces/current/default-model?model_type=${ModelTypeEnum.textGeneration}`, fetchDefaultModal)
  const { data: embeddingsDefaultModel, mutate: mutateEmbeddingsDefaultModel } = useSWR(`/workspaces/current/default-model?model_type=${ModelTypeEnum.textEmbedding}`, fetchDefaultModal)
  const { data: speech2textDefaultModel, mutate: mutateSpeech2textDefaultModel } = useSWR(`/workspaces/current/default-model?model_type=${ModelTypeEnum.speech2text}`, fetchDefaultModal)
  const { data: rerankDefaultModel, mutate: mutateRerankDefaultModel } = useSWR(`/workspaces/current/default-model?model_type=${ModelTypeEnum.rerank}`, fetchDefaultModal)
  const { data: moderationDefaultModel, mutate: mutateModerationDefaultModel } = useSWR(`/workspaces/current/default-model?model_type=${ModelTypeEnum.rerank}`, fetchDefaultModal)
  const fetchModelListUrlPrefix = '/workspaces/current/models/model-types/'
  const { data: textGenerationModelList, mutate: mutateTextGenerationModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.textGeneration}`, fetchModelList)
  const { data: embeddingsModelList, mutate: mutateEmbeddingsModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.textEmbedding}`, fetchModelList)
  const { data: speech2textModelList, mutate: mutateSpeech2textModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.speech2text}`, fetchModelList)
  const { data: rerankModelList, mutate: mutateRerankModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.rerank}`, fetchModelList)
  const { data: moderationModelList, mutate: mutateModerationModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.moderation}`, fetchModelList)
  const { data: supportRetrievalMethods } = useSWR('/datasets/retrieval-setting', fetchSupportRetrievalMethods)

  // const agentThoughtModelList = textGenerationModelList?.data?.filter((item) => {
  //   return item.features?.includes(ModelFeature.agentThought)
  // })

  // const isRerankDefaultModelVaild = !!rerankModelList?.find(
  //   item => item.model_name === rerankDefaultModel?.model_name && item.model_provider.provider_name === rerankDefaultModel?.model_provider.provider_name,
  // )

  const isRerankDefaultModelVaild = false

  // const isEmbeddingsDefaultModelValid = !!embeddingsModelList?.find(
  //   item => item.model_name === embeddingsDefaultModel?.model_name && item.model_provider.provider_name === embeddingsDefaultModel?.model_provider.provider_name,
  // )

  const isEmbeddingsDefaultModelValid = false

  const updateModelList = (type: ModelTypeEnum) => {
    if (type === ModelTypeEnum.textGeneration)
      mutateTextGenerationModelList()
    if (type === ModelTypeEnum.textEmbedding)
      mutateEmbeddingsModelList()
    if (type === ModelTypeEnum.speech2text)
      mutateSpeech2textModelList()
    if (type === ModelTypeEnum.rerank)
      mutateRerankModelList()
    if (type === ModelTypeEnum.moderation)
      mutateModerationModelList()
  }

  const [plan, setPlan] = useState(defaultPlan)
  const [isFetchedPlan, setIsFetchedPlan] = useState(false)
  const [enableBilling, setEnableBilling] = useState(true)
  const [enableReplaceWebAppLogo, setEnableReplaceWebAppLogo] = useState(false)
  useEffect(() => {
    (async () => {
      const data = await fetchCurrentPlanInfo()
      const enabled = data.billing.enabled
      setEnableBilling(enabled)
      setEnableReplaceWebAppLogo(data.can_replace_logo)
      if (enabled) {
        setPlan(parseCurrentPlan(data))
        // setPlan(parseCurrentPlan({
        //   ...data,
        //   annotation_quota_limit: {
        //     ...data.annotation_quota_limit,
        //     limit: 10,
        //   },
        // }))
        setIsFetchedPlan(true)
      }
    })()
  }, [])

  return (
    <ProviderContext.Provider value={{
      textGenerationModelList: textGenerationModelList?.data || [],
      embeddingsModelList: embeddingsModelList?.data || [],
      speech2textModelList: speech2textModelList?.data || [],
      rerankModelList: rerankModelList?.data || [],
      moderationModelList: moderationModelList?.data || [],
      agentThoughtModelList: [],
      updateModelList,
      textGenerationDefaultModel: textGenerationDefaultModel?.data,
      mutateTextGenerationDefaultModel,
      embeddingsDefaultModel: embeddingsDefaultModel?.data,
      mutateEmbeddingsDefaultModel,
      speech2textDefaultModel: speech2textDefaultModel?.data,
      mutateSpeech2textDefaultModel,
      rerankDefaultModel: rerankDefaultModel?.data,
      isRerankDefaultModelVaild,
      isEmbeddingsDefaultModelValid,
      mutateRerankDefaultModel,
      moderationDefaultModel: moderationDefaultModel?.data,
      mutateModerationDefaultModel,
      hasSettedApiKey: !!textGenerationModelList?.data.some(model => model.status === ModelStatusEnum.active),
      supportRetrievalMethods: supportRetrievalMethods?.retrieval_method || [],
      plan,
      isFetchedPlan,
      enableBilling,
      enableReplaceWebAppLogo,
    }}>
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
