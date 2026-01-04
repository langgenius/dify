'use client'

import type { Plan, UsagePlanInfo, UsageResetInfo } from '@/app/components/billing/type'
import type { Model, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import { useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { noop } from 'es-toolkit/function'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import Toast from '@/app/components/base/toast'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { defaultPlan } from '@/app/components/billing/config'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import {
  CurrentSystemQuotaTypeEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ZENDESK_FIELD_IDS } from '@/config'
import { fetchCurrentPlanInfo } from '@/service/billing'
import {
  useModelListByType,
  useModelProviders,
  useSupportRetrievalMethods,
} from '@/service/use-common'
import {
  useEducationStatus,
} from '@/service/use-education'

export type ProviderContextState = {
  modelProviders: ModelProvider[]
  refreshModelProviders: () => void
  textGenerationModelList: Model[]
  supportRetrievalMethods: RETRIEVE_METHOD[]
  isAPIKeySet: boolean
  plan: {
    type: Plan
    usage: UsagePlanInfo
    total: UsagePlanInfo
    reset: UsageResetInfo
  }
  isFetchedPlan: boolean
  enableBilling: boolean
  onPlanInfoChanged: () => void
  enableReplaceWebAppLogo: boolean
  modelLoadBalancingEnabled: boolean
  datasetOperatorEnabled: boolean
  enableEducationPlan: boolean
  isEducationWorkspace: boolean
  isEducationAccount: boolean
  allowRefreshEducationVerify: boolean
  educationAccountExpireAt: number | null
  isLoadingEducationAccountInfo: boolean
  isFetchingEducationAccountInfo: boolean
  webappCopyrightEnabled: boolean
  licenseLimit: {
    workspace_members: {
      size: number
      limit: number
    }
  }
  refreshLicenseLimit: () => void
  isAllowTransferWorkspace: boolean
  isAllowPublishAsCustomKnowledgePipelineTemplate: boolean
}

export const baseProviderContextValue: ProviderContextState = {
  modelProviders: [],
  refreshModelProviders: noop,
  textGenerationModelList: [],
  supportRetrievalMethods: [],
  isAPIKeySet: true,
  plan: defaultPlan,
  isFetchedPlan: false,
  enableBilling: false,
  onPlanInfoChanged: noop,
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  datasetOperatorEnabled: false,
  enableEducationPlan: false,
  isEducationWorkspace: false,
  isEducationAccount: false,
  allowRefreshEducationVerify: false,
  educationAccountExpireAt: null,
  isLoadingEducationAccountInfo: false,
  isFetchingEducationAccountInfo: false,
  webappCopyrightEnabled: false,
  licenseLimit: {
    workspace_members: {
      size: 0,
      limit: 0,
    },
  },
  refreshLicenseLimit: noop,
  isAllowTransferWorkspace: false,
  isAllowPublishAsCustomKnowledgePipelineTemplate: false,
}

const ProviderContext = createContext<ProviderContextState>(baseProviderContextValue)

export const useProviderContext = () => useContext(ProviderContext)

// Adding a dangling comma to avoid the generic parsing issue in tsx, see:
// https://github.com/microsoft/TypeScript/issues/15713
export const useProviderContextSelector = <T,>(selector: (state: ProviderContextState) => T): T =>
  useContextSelector(ProviderContext, selector)

type ProviderContextProviderProps = {
  children: React.ReactNode
}
export const ProviderContextProvider = ({
  children,
}: ProviderContextProviderProps) => {
  const queryClient = useQueryClient()
  const { data: providersData } = useModelProviders()
  const { data: textGenerationModelList } = useModelListByType(ModelTypeEnum.textGeneration)
  const { data: supportRetrievalMethods } = useSupportRetrievalMethods()

  const [plan, setPlan] = useState(defaultPlan)
  const [isFetchedPlan, setIsFetchedPlan] = useState(false)
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
  const { data: educationAccountInfo, isLoading: isLoadingEducationAccountInfo, isFetching: isFetchingEducationAccountInfo, isFetchedAfterMount: isEducationDataFetchedAfterMount } = useEducationStatus(!enableEducationPlan)
  const [isAllowTransferWorkspace, setIsAllowTransferWorkspace] = useState(false)
  const [isAllowPublishAsCustomKnowledgePipelineTemplate, setIsAllowPublishAsCustomKnowledgePipelineTemplate] = useState(false)

  const refreshModelProviders = () => {
    queryClient.invalidateQueries({ queryKey: ['common', 'model-providers'] })
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
        setPlan(parseCurrentPlan(data) as any)
        setIsFetchedPlan(true)
      }

      if (data.model_load_balancing_enabled)
        setModelLoadBalancingEnabled(true)
      if (data.dataset_operator_enabled)
        setDatasetOperatorEnabled(true)
      if (data.webapp_copyright_enabled)
        setWebappCopyrightEnabled(true)
      if (data.workspace_members)
        setLicenseLimit({ workspace_members: data.workspace_members })
      if (data.is_allow_transfer_workspace)
        setIsAllowTransferWorkspace(data.is_allow_transfer_workspace)
      if (data.knowledge_pipeline?.publish_enabled)
        setIsAllowPublishAsCustomKnowledgePipelineTemplate(data.knowledge_pipeline?.publish_enabled)
    }
    catch (error) {
      console.error('Failed to fetch plan info:', error)
      // set default value to avoid undefined error
      setEnableBilling(false)
      setEnableEducationPlan(false)
      setIsEducationWorkspace(false)
      setEnableReplaceWebAppLogo(false)
    }
  }
  useEffect(() => {
    fetchPlan()
  }, [])

  // #region Zendesk conversation fields
  useEffect(() => {
    if (ZENDESK_FIELD_IDS.PLAN && plan.type) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.PLAN,
        value: `${plan.type}-plan`,
      }])
    }
  }, [plan.type])
  // #endregion Zendesk conversation fields

  const { t } = useTranslation()
  useEffect(() => {
    if (localStorage.getItem('anthropic_quota_notice') === 'true')
      return

    if (dayjs().isAfter(dayjs('2025-03-17')))
      return

    if (providersData?.data && providersData.data.length > 0) {
      const anthropic = providersData.data.find(provider => provider.provider === 'anthropic')
      if (anthropic && anthropic.system_configuration.current_quota_type === CurrentSystemQuotaTypeEnum.trial) {
        const quota = anthropic.system_configuration.quota_configurations.find(item => item.quota_type === anthropic.system_configuration.current_quota_type)
        if (quota && quota.is_valid && quota.quota_used < quota.quota_limit) {
          Toast.notify({
            type: 'info',
            message: t('provider.anthropicHosted.trialQuotaTip', { ns: 'common' }),
            duration: 60000,
            onClose: () => {
              localStorage.setItem('anthropic_quota_notice', 'true')
            },
          })
        }
      }
    }
  }, [providersData, t])

  return (
    <ProviderContext.Provider value={{
      modelProviders: providersData?.data || [],
      refreshModelProviders,
      textGenerationModelList: textGenerationModelList?.data || [],
      isAPIKeySet: !!textGenerationModelList?.data?.some(model => model.status === ModelStatusEnum.active),
      supportRetrievalMethods: supportRetrievalMethods?.retrieval_method || [],
      plan,
      isFetchedPlan,
      enableBilling,
      onPlanInfoChanged: fetchPlan,
      enableReplaceWebAppLogo,
      modelLoadBalancingEnabled,
      datasetOperatorEnabled,
      enableEducationPlan,
      isEducationWorkspace,
      isEducationAccount: isEducationDataFetchedAfterMount ? (educationAccountInfo?.is_student ?? false) : false,
      allowRefreshEducationVerify: isEducationDataFetchedAfterMount ? (educationAccountInfo?.allow_refresh ?? false) : false,
      educationAccountExpireAt: isEducationDataFetchedAfterMount ? (educationAccountInfo?.expire_at ?? null) : null,
      isLoadingEducationAccountInfo,
      isFetchingEducationAccountInfo,
      webappCopyrightEnabled,
      licenseLimit,
      refreshLicenseLimit: fetchPlan,
      isAllowTransferWorkspace,
      isAllowPublishAsCustomKnowledgePipelineTemplate,
    }}
    >
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
