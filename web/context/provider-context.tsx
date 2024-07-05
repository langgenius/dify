'use client'

import { createContext, useContext, useContextSelector } from 'use-context-selector'
import useSWR from 'swr'
import { useEffect, useState } from 'react'
import {
  fetchModelList,
  fetchModelProviders,
  fetchSupportRetrievalMethods,
} from '@/service/common'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Model, ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import { Plan, type UsagePlanInfo } from '@/app/components/billing/type'
import { fetchCurrentPlanInfo } from '@/service/billing'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import { defaultPlan } from '@/app/components/billing/config'

type ProviderContextState = {
  modelProviders: ModelProvider[]
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
}
const ProviderContext = createContext<ProviderContextState>({
  modelProviders: [],
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
  onPlanInfoChanged: () => { },
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
})

export const useProviderContext = () => useContext(ProviderContext)

// Adding a dangling comma to avoid the generic parsing issue in tsx, see:
// https://github.com/microsoft/TypeScript/issues/15713
// eslint-disable-next-line @typescript-eslint/comma-dangle
export const useProviderContextSelector = <T,>(selector: (state: ProviderContextState) => T): T =>
  useContextSelector(ProviderContext, selector)

type ProviderContextProviderProps = {
  children: React.ReactNode
}
export const ProviderContextProvider = ({
  children,
}: ProviderContextProviderProps) => {
  const { data: providersData } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const fetchModelListUrlPrefix = '/workspaces/current/models/model-types/'
  const { data: textGenerationModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.textGeneration}`, fetchModelList)
  const { data: supportRetrievalMethods } = useSWR('/datasets/retrieval-setting', fetchSupportRetrievalMethods)

  const [plan, setPlan] = useState(defaultPlan)
  const [isFetchedPlan, setIsFetchedPlan] = useState(false)
  const [enableBilling, setEnableBilling] = useState(true)
  const [enableReplaceWebAppLogo, setEnableReplaceWebAppLogo] = useState(false)
  const [modelLoadBalancingEnabled, setModelLoadBalancingEnabled] = useState(false)

  const fetchPlan = async () => {
    const data = await fetchCurrentPlanInfo()
    const enabled = data.billing.enabled
    setEnableBilling(enabled)
    setEnableReplaceWebAppLogo(data.can_replace_logo)
    if (enabled) {
      setPlan(parseCurrentPlan(data))
      setIsFetchedPlan(true)
    }
    if (data.model_load_balancing_enabled)
      setModelLoadBalancingEnabled(true)
  }
  useEffect(() => {
    fetchPlan()
  }, [])

  return (
    <ProviderContext.Provider value={{
      modelProviders: providersData?.data || [],
      textGenerationModelList: textGenerationModelList?.data || [],
      isAPIKeySet: !!textGenerationModelList?.data.some(model => model.status === ModelStatusEnum.active),
      supportRetrievalMethods: supportRetrievalMethods?.retrieval_method || [],
      plan,
      isFetchedPlan,
      enableBilling,
      onPlanInfoChanged: fetchPlan,
      enableReplaceWebAppLogo,
      modelLoadBalancingEnabled,
    }}>
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
