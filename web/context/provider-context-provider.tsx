'use client'

import type { FeatureResponse } from '@dify/contracts/api/console/features/types.gen'
import type { ReactNode } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { defaultPlan } from '@/app/components/billing/config'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import {
  CurrentSystemQuotaTypeEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ZENDESK_FIELD_IDS } from '@/config'
import { consoleQuery } from '@/service/client'
import {
  useModelListByType,
  useModelProviders,
  useSupportRetrievalMethods,
} from '@/service/use-common'
import { useEducationStatus } from '@/service/use-education'
import { ProviderContext } from './provider-context'
import { useAnthropicQuotaNotice } from './provider-storage'

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

const resolveMemberInviteLimit = (data: FeatureResponse | undefined): MemberInviteLimit => {
  if (!data) return unlimitedMemberInviteLimit

  if (data.workspace_members.enabled) {
    return {
      size: data.workspace_members.size,
      limit: data.workspace_members.limit,
    }
  }

  if (data.billing.enabled && data.members.limit > 0) {
    return {
      size: data.members.size,
      limit: data.members.limit,
    }
  }

  return unlimitedMemberInviteLimit
}

export const ProviderContextProvider = ({ children }: ProviderContextProviderProps) => {
  const queryClient = useQueryClient()
  const { data: providersData, isLoading: isLoadingModelProviders } = useModelProviders()
  const { data: textGenerationModelList } = useModelListByType(ModelTypeEnum.textGeneration)
  const { data: supportRetrievalMethods } = useSupportRetrievalMethods()
  const {
    data: planInfo,
    isFetched: isFetchedPlanInfo,
    refetch: refetchPlanInfo,
  } = useQuery(consoleQuery.features.get.queryOptions())
  const enableBilling = planInfo?.billing.enabled ?? !isFetchedPlanInfo
  const enableEducationPlan = planInfo?.education.enabled ?? false
  const plan = planInfo?.billing.enabled ? parseCurrentPlan(planInfo) : defaultPlan
  const isFetchedPlan = Boolean(planInfo?.billing.enabled)
  const licenseLimit = { workspace_members: resolveMemberInviteLimit(planInfo) }
  const refreshPlanInfo = () => {
    void refetchPlanInfo()
  }
  const {
    data: educationAccountInfo,
    isLoading: isLoadingEducationAccountInfo,
    isFetching: isFetchingEducationAccountInfo,
    isFetchedAfterMount: isEducationDataFetchedAfterMount,
  } = useEducationStatus(!enableEducationPlan)
  const refreshModelProviders = () => {
    queryClient.invalidateQueries({ queryKey: ['common', 'model-providers'] })
  }

  // #region Zendesk conversation fields
  useEffect(() => {
    if (ZENDESK_FIELD_IDS.PLAN && plan.type) {
      setZendeskConversationFields([
        {
          id: ZENDESK_FIELD_IDS.PLAN,
          value: `${plan.type}-plan`,
        },
      ])
    }
  }, [plan.type])
  // #endregion Zendesk conversation fields

  const { t } = useTranslation()
  const [anthropicQuotaNotice, setAnthropicQuotaNotice] = useAnthropicQuotaNotice()

  useEffect(() => {
    if (anthropicQuotaNotice === 'true') return

    if (dayjs().isAfter(dayjs('2025-03-17'))) return

    if (providersData?.data && providersData.data.length > 0) {
      const anthropic = providersData.data.find((provider) => provider.provider === 'anthropic')
      if (
        anthropic &&
        anthropic.system_configuration.current_quota_type === CurrentSystemQuotaTypeEnum.trial
      ) {
        const quota = anthropic.system_configuration.quota_configurations.find(
          (item) => item.quota_type === anthropic.system_configuration.current_quota_type,
        )
        if (quota && quota.is_valid && quota.quota_used < quota.quota_limit) {
          setAnthropicQuotaNotice('true')
          toast.info(
            t(($) => $['provider.anthropicHosted.trialQuotaTip'], { ns: 'common' }),
            {
              timeout: 60000,
            },
          )
        }
      }
    }
  }, [anthropicQuotaNotice, providersData, setAnthropicQuotaNotice, t])

  return (
    <ProviderContext.Provider
      value={{
        modelProviders: providersData?.data || [],
        isLoadingModelProviders,
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
        onPlanInfoChanged: refreshPlanInfo,
        enableReplaceWebAppLogo: planInfo?.can_replace_logo ?? false,
        modelLoadBalancingEnabled: planInfo?.model_load_balancing_enabled ?? false,
        datasetOperatorEnabled: planInfo?.dataset_operator_enabled ?? false,
        enableEducationPlan,
        isEducationWorkspace: planInfo?.education.activated ?? false,
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
        webappCopyrightEnabled: planInfo?.webapp_copyright_enabled ?? false,
        licenseLimit,
        refreshLicenseLimit: refreshPlanInfo,
        isAllowTransferWorkspace: planInfo?.is_allow_transfer_workspace ?? false,
        isAllowPublishAsCustomKnowledgePipelineTemplate:
          planInfo?.knowledge_pipeline.publish_enabled ?? false,
        humanInputEmailDeliveryEnabled: planInfo?.human_input_email_delivery_enabled ?? false,
      }}
    >
      {children}
    </ProviderContext.Provider>
  )
}
