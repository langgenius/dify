'use client'

import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { defaultPlan } from '@/app/components/billing/config'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ZENDESK_FIELD_IDS } from '@/config'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/client'
import {
  commonQueryKeys,
  useModelListByType,
  useSupportRetrievalMethods,
} from '@/service/use-common'
import { ProviderContext } from './provider-context'

type ProviderContextProviderProps = {
  children: ReactNode
}

export const ProviderContextProvider = ({ children }: ProviderContextProviderProps) => {
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const queryClient = useQueryClient()
  const featuresQuery = useQuery(consoleQuery.features.get.queryOptions())
  const {
    data: providersData,
    isLoading: isLoadingModelProviders,
    isSuccess: isSuccessModelProviders,
  } = useQuery(consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions())
  const { data: textGenerationModelList } = useModelListByType(ModelTypeEnum.textGeneration)
  const { data: supportRetrievalMethods } = useSupportRetrievalMethods()

  const features = featuresQuery.data
  const enableBilling = features?.billing.enabled ?? false
  const plan = enableBilling && features ? parseCurrentPlan(features) : defaultPlan
  const isFetchedPlan = featuresQuery.isSuccess && enableBilling
  const isFetchedPlanInfo = featuresQuery.isFetched
  const enableEducationPlan = features?.education.enabled ?? false
  const enableReplaceWebAppLogo = features?.can_replace_logo ?? false
  const modelLoadBalancingEnabled = features?.model_load_balancing_enabled ?? false
  const webappCopyrightEnabled = features?.webapp_copyright_enabled ?? false
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

  const refreshFeatures = () =>
    queryClient
      .invalidateQueries({ queryKey: consoleQuery.features.get.key() })
      .then(() => undefined)

  // #region Zendesk conversation fields
  useEffect(() => {
    if (ZENDESK_FIELD_IDS.PLAN && plan.type) {
      setZendeskConversationFields(
        [
          {
            id: ZENDESK_FIELD_IDS.PLAN,
            value: `${plan.type}-plan`,
          },
        ],
        deploymentEdition,
      )
    }
  }, [deploymentEdition, plan.type])
  // #endregion Zendesk conversation fields

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
        supportRetrievalMethods: supportRetrievalMethods?.retrieval_method || [],
        plan,
        isFetchedPlan,
        isFetchedPlanInfo,
        enableBilling,
        onPlanInfoChanged: refreshFeatures,
        enableReplaceWebAppLogo,
        modelLoadBalancingEnabled,
        enableEducationPlan,
        webappCopyrightEnabled,
        isAllowTransferWorkspace,
        isAllowPublishAsCustomKnowledgePipelineTemplate,
        humanInputEmailDeliveryEnabled,
      }}
    >
      {children}
    </ProviderContext.Provider>
  )
}
