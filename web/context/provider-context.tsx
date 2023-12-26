'use client'

import { createContext, useContext } from 'use-context-selector'
import useSWR from 'swr'
import { useEffect, useState } from 'react'
import { fetchModelList, fetchSupportRetrievalMethods } from '@/service/common'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Model } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { RETRIEVE_METHOD } from '@/types/app'
import { Plan, type UsagePlanInfo } from '@/app/components/billing/type'
import { fetchCurrentPlanInfo } from '@/service/billing'
import { parseCurrentPlan } from '@/app/components/billing/utils'
import { defaultPlan } from '@/app/components/billing/config'

const ProviderContext = createContext<{
  textGenerationModelList: Model[]
  agentThoughtModelList: Model[]
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
  agentThoughtModelList: [],
  supportRetrievalMethods: [],
  hasSettedApiKey: true,
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
  const fetchModelListUrlPrefix = '/workspaces/current/models/model-types/'
  const { data: textGenerationModelList } = useSWR(`${fetchModelListUrlPrefix}${ModelTypeEnum.textGeneration}`, fetchModelList)
  const { data: supportRetrievalMethods } = useSWR('/datasets/retrieval-setting', fetchSupportRetrievalMethods)

  // const agentThoughtModelList = textGenerationModelList?.data?.filter((item) => {
  //   return item.features?.includes(ModelFeature.agentThought)
  // })

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
      agentThoughtModelList: [],
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
