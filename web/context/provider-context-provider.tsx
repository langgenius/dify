'use client'

import type { ReactNode } from 'react'
import type { ProviderContextState } from './provider-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { defaultPlan } from '@/app/components/billing/config'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ZENDESK_FIELD_IDS } from '@/config'
import { deploymentEditionAtom } from '@/context/system-features-state'
import { fetchCurrentPlanInfo } from '@/service/billing'
import { consoleQuery } from '@/service/client'
import {
  commonQueryKeys,
  useModelListByType,
  useSupportRetrievalMethods,
} from '@/service/use-common'
import { useEducationStatus } from '@/service/use-education'
import { ProviderContext } from './provider-context'

type ProviderContextProviderProps = {
  children: ReactNode
}

type MemberInviteLimit = {
  size: number
  limit: number
}

const unlimitedMemberInviteLimit: MemberInviteLimit = {
  size: 0,
  limit: 0,
}

const resolveMemberInviteLimit = (
  data: Awaited<ReturnType<typeof fetchCurrentPlanInfo>>,
): MemberInviteLimit => {
  if (!data) return unlimitedMemberInviteLimit

  if (data.workspace_members?.enabled) {
    return {
      size: data.workspace_members.size,
      limit: data.workspace_members.limit,
    }
  }

  if (data.billing?.enabled && data.members?.limit > 0) {
    return {
      size: data.members.size,
      limit: data.members.limit,
    }
  }

  return unlimitedMemberInviteLimit
}

export const ProviderContextProvider = ({ children }: ProviderContextProviderProps) => {
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const queryClient = useQueryClient()
  const {
    data: providersData,
    isLoading: isLoadingModelProviders,
    isSuccess: isSuccessModelProviders,
  } = useQuery(consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions())
  const { data: textGenerationModelList } = useModelListByType(ModelTypeEnum.textGeneration)
  const { data: supportRetrievalMethods } = useSupportRetrievalMethods()

  const [plan, setPlan] = useState<ProviderContextState['plan']>(defaultPlan)
  const [isFetchedPlan, setIsFetchedPlan] = useState(false)
  const [isFetchedPlanInfo, setIsFetchedPlanInfo] = useState(false)
  const [enableBilling, setEnableBilling] = useState(true)
  const [enableReplaceWebAppLogo, setEnableReplaceWebAppLogo] = useState(false)
  const [modelLoadBalancingEnabled, setModelLoadBalancingEnabled] = useState(false)
  const [datasetOperatorEnabled, setDatasetOperatorEnabled] = useState(false)
  const [webappCopyrightEnabled, setWebappCopyrightEnabled] = useState(false)
  const [licenseLimit, setLicenseLimit] = useState({
    workspace_members: {
      size: 0,
      limit: 0,
    },
  })

  const [enableEducationPlan, setEnableEducationPlan] = useState(false)
  const [isEducationWorkspace, setIsEducationWorkspace] = useState(false)
  const {
    data: educationAccountInfo,
    isLoading: isLoadingEducationAccountInfo,
    isFetching: isFetchingEducationAccountInfo,
    isFetchedAfterMount: isEducationDataFetchedAfterMount,
  } = useEducationStatus(!enableEducationPlan)
  const [isAllowTransferWorkspace, setIsAllowTransferWorkspace] = useState(false)
  const [
    isAllowPublishAsCustomKnowledgePipelineTemplate,
    setIsAllowPublishAsCustomKnowledgePipelineTemplate,
  ] = useState(false)
  const [humanInputEmailDeliveryEnabled, setHumanInputEmailDeliveryEnabled] = useState(false)

  const refreshModelProviders = () => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
    })
    queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelProviderDetails })
  }

  const fetchPlan = async () => {
    try {
      const data = await fetchCurrentPlanInfo()
      if (!data) {
        console.error('Failed to fetch plan info: data is undefined')
        return
      }

      // set default value to avoid undefined error
      setEnableBilling(data.billing?.enabled ?? false)
      setEnableEducationPlan(data.education?.enabled ?? false)
      setIsEducationWorkspace(data.education?.activated ?? false)
      setEnableReplaceWebAppLogo(data.can_replace_logo ?? false)

      if (data.billing?.enabled) {
        setPlan(parseCurrentPlan(data))
        setIsFetchedPlan(true)
      }

      if (data.model_load_balancing_enabled) setModelLoadBalancingEnabled(true)
      if (data.dataset_operator_enabled) setDatasetOperatorEnabled(true)
      if (data.webapp_copyright_enabled) setWebappCopyrightEnabled(true)
      setLicenseLimit({ workspace_members: resolveMemberInviteLimit(data) })
      if (data.is_allow_transfer_workspace)
        setIsAllowTransferWorkspace(data.is_allow_transfer_workspace)
      if (data.knowledge_pipeline?.publish_enabled)
        setIsAllowPublishAsCustomKnowledgePipelineTemplate(data.knowledge_pipeline?.publish_enabled)
      if (data.human_input_email_delivery_enabled)
        setHumanInputEmailDeliveryEnabled(data.human_input_email_delivery_enabled)
    } catch (error) {
      console.error('Failed to fetch plan info:', error)
      // set default value to avoid undefined error
      setEnableBilling(false)
      setEnableEducationPlan(false)
      setIsEducationWorkspace(false)
      setEnableReplaceWebAppLogo(false)
    } finally {
      setIsFetchedPlanInfo(true)
    }
  }
  useEffect(() => {
    fetchPlan()
  }, [])

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
        onPlanInfoChanged: fetchPlan,
        enableReplaceWebAppLogo,
        modelLoadBalancingEnabled,
        datasetOperatorEnabled,
        enableEducationPlan,
        isEducationWorkspace,
        isEducationAccount: isEducationDataFetchedAfterMount
          ? (educationAccountInfo?.is_student ?? false)
          : false,
        allowRefreshEducationVerify: isEducationDataFetchedAfterMount
          ? (educationAccountInfo?.allow_refresh ?? false)
          : false,
        educationAccountExpireAt: isEducationDataFetchedAfterMount
          ? (educationAccountInfo?.expire_at ?? null)
          : null,
        isLoadingEducationAccountInfo,
        isFetchingEducationAccountInfo,
        webappCopyrightEnabled,
        licenseLimit,
        refreshLicenseLimit: fetchPlan,
        isAllowTransferWorkspace,
        isAllowPublishAsCustomKnowledgePipelineTemplate,
        humanInputEmailDeliveryEnabled,
      }}
    >
      {children}
    </ProviderContext.Provider>
  )
}
