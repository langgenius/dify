'use client'

import { createContext, useContext } from 'use-context-selector'
import useSWR from 'swr'
import { fetchTenantInfo } from '@/service/common'

const ProviderContext = createContext<{ currentProvider: {
  provider: string
  provider_name: string
  token_is_set: boolean
  is_valid: boolean
  token_is_valid: boolean
} | null | undefined }>({
  currentProvider: null,
})

export const useProviderContext = () => useContext(ProviderContext)

type ProviderContextProviderProps = {
  children: React.ReactNode
}
export const ProviderContextProvider = ({
  children,
}: ProviderContextProviderProps) => {
  const { data: userInfo } = useSWR({ url: '/info' }, fetchTenantInfo)
  const currentProvider = userInfo?.providers?.find(({ token_is_set, is_valid, provider_name }) => token_is_set && is_valid && (provider_name === 'openai' || provider_name === 'azure_openai'))

  return (
    <ProviderContext.Provider value={{ currentProvider }}>
      {children}
    </ProviderContext.Provider>
  )
}

export default ProviderContext
