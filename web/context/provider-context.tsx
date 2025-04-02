'use client'

import { createContext, useContext, useContextSelector } from 'use-context-selector'
import useSWR from 'swr'
import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import {
  fetchModelList,
  fetchModelProviders,
  fetchSupportRetrievalMethods,
} from '@/service/common'
import {
  CurrentSystemQuotaTypeEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Model, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import { Plan, type UsagePlanInfo } from '@/app/components/billing/type'
import { fetchCurrentPlanInfo } from '@/service/billing'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import { defaultPlan } from '@/app/components/billing/config'
import Toast from '@/app/components/base/toast'
import {
  useEducationStatus,
} from '@/service/use-education'

type ProviderContextState = {
  modelProviders: ModelProvider[]
  refreshModelProviders: () => void
  textGenerationModelList: Model[]
  supportRetrievalMethods: RETRIEVE_METHOD[]
  isAPIKeySet: boolean
  plan: {
    type: Plan
    usage: UsagePlanInfo
    total: UsagePlanInfo
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
}
const ProviderContext = createContext<ProviderContextState>({
  modelProviders: [],
  refreshModelProviders: () => { },
  textGenerationModelList: [],
  supportRetrievalMethods: [],
  isAPIKeySet: true,
  plan: {
    type: Plan.sandbox,
    usage: {
      vectorSpace: 32,
      buildApps: 12,
      teamMembers: 1,
      annotatedResponse: 1,
      documentsUploadQuota: 50,
    },
    total: {
      vectorSpace: 200,
      buildApps: 50,
      teamMembers: 1,
      annotatedResponse: 10,
      documentsUploadQuota: 500,
    },
  },
  isFetchedPlan: false,
  enableBilling: false,
  onPlanInfoChanged: () => { },
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  datasetOperatorEnabled: false,
  enableEducationPlan: false,
  isEducationWorkspace: false,
  isEducationAccount: false,
})

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
  const { data: providersData, mutate: refreshModelProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const fetchModelListUrlPrefix = '/workspaces/current/models/model-types/'
  const { data: textGenerationModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.textGeneration}`, fetchModelList)
  const { data: supportRetrievalMethods } = useSWR('/datasets/retrieval-setting', fetchSupportRetrievalMethods)

  const [plan, setPlan] = useState(defaultPlan)
  const [isFetchedPlan, setIsFetchedPlan] = useState(false)
  const [enableBilling, setEnableBilling] = useState(true)
  const [enableReplaceWebAppLogo, setEnableReplaceWebAppLogo] = useState(false)
  const [modelLoadBalancingEnabled, setModelLoadBalancingEnabled] = useState(false)
  const [datasetOperatorEnabled, setDatasetOperatorEnabled] = useState(false)

  const [enableEducationPlan, setEnableEducationPlan] = useState(false)
  const [isEducationWorkspace, setIsEducationWorkspace] = useState(false)
  const { data: isEducationAccount } = useEducationStatus(!enableEducationPlan)

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
            message: t('common.provider.anthropicHosted.trialQuotaTip'),
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
      isAPIKeySet: !!textGenerationModelList?.data.some(model => model.status === ModelStatusEnum.active),
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
      isEducationAccount: isEducationAccount?.result || false,
    }}>
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
