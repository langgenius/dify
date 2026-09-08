'use client'

import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/client'
import { commonQueryKeys, useModelListByType } from '@/service/use-common'
import { ProviderContext } from './provider-context'

type ProviderContextProviderProps = {
  children: ReactNode
}

export const ProviderContextProvider = ({ children }: ProviderContextProviderProps) => {
  const queryClient = useQueryClient()
  const featuresQuery = useQuery(consoleQuery.features.get.queryOptions())
  const {
    data: providersData,
    isLoading: isLoadingModelProviders,
    isSuccess: isSuccessModelProviders,
  } = useQuery(consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions())
  const { data: textGenerationModelList } = useModelListByType(ModelTypeEnum.textGeneration)

  const features = featuresQuery.data
  const enableEducationPlan = features?.education.enabled ?? false
  const enableSkill = features?.enable_skill ?? false
  const enableReplaceWebAppLogo = features?.can_replace_logo ?? false
  const modelLoadBalancingEnabled = features?.model_load_balancing_enabled ?? false
  const isAllowTransferWorkspace = features?.is_allow_transfer_workspace ?? false
  const isAllowPublishAsCustomKnowledgePipelineTemplate =
    features?.knowledge_pipeline.publish_enabled ?? false
  const humanInputEmailDeliveryEnabled = features?.human_input_email_delivery_enabled ?? false

  const refreshModelProviders = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
      }),
      queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelProviderDetails }),
    ]).then(() => undefined)

  return (
    <ProviderContext.Provider
      value={{
        modelProviders: providersData?.data || [],
        modelProviderPlugins: providersData?.plugins || {},
        isLoadingModelProviders,
        isSuccessModelProviders,
        refreshModelProviders,
        textGenerationModelList: textGenerationModelList?.data || [],
        isAPIKeySet: !!textGenerationModelList?.data?.some(
          (model) => model.status === ModelStatusEnum.active,
        ),
        enableSkill,
        enableReplaceWebAppLogo,
        modelLoadBalancingEnabled,
        enableEducationPlan,
        isAllowTransferWorkspace,
        isAllowPublishAsCustomKnowledgePipelineTemplate,
        humanInputEmailDeliveryEnabled,
      }}
    >
      {children}
    </ProviderContext.Provider>
  )
}
