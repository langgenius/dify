'use client'

import { createContext, useContext } from 'use-context-selector'
import useSWR from 'swr'
import { fetchModelProviders, fetchTenantInfo } from '@/service/common'
import type { ModelProvider } from '@/app/components/header/account-setting/model-page/declarations'

const ProviderContext = createContext<{ currentProvider: {
  provider: string
  provider_name: string
  token_is_set: boolean
  is_valid: boolean
  token_is_valid: boolean
} | null | undefined
providers: ModelProvider | undefined
mutateProviders: any
}>({
  currentProvider: null,
  providers: undefined,
  mutateProviders: () => {},
})

export const useProviderContext = () => useContext(ProviderContext)

type ProviderContextProviderProps = {
  children: React.ReactNode
}
export const ProviderContextProvider = ({
  children,
}: ProviderContextProviderProps) => {
  const { data: userInfo } = useSWR({ url: '/info' }, fetchTenantInfo)
  const { data: providers, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const currentProvider = userInfo?.providers?.find(({ token_is_set, is_valid, provider_name }) => token_is_set && is_valid && (provider_name === 'openai' || provider_name === 'azure_openai'))
  console.log(providers)

  return (
    <ProviderContext.Provider value={{ currentProvider, providers, mutateProviders }}>
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
