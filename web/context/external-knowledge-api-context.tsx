'use client'

import { useMemo } from 'react'
import type { FC, ReactNode } from 'react'
import useSWR from 'swr'
import type { ExternalAPIItem, ExternalAPIListResponse } from '@/models/datasets'
import { fetchExternalAPIList } from '@/service/datasets'
import { createCtx } from '@/utils/context'

type ExternalKnowledgeApiContextType = {
  externalKnowledgeApiList: ExternalAPIItem[]
  mutateExternalKnowledgeApis: () => Promise<ExternalAPIListResponse | undefined>
  isLoading: boolean
}

const [,useExternalKnowledgeApi, ExternalKnowledgeApiContext] = createCtx<ExternalKnowledgeApiContextType>()

export type ExternalKnowledgeApiProviderProps = {
  children: ReactNode
}

export const ExternalKnowledgeApiProvider: FC<ExternalKnowledgeApiProviderProps> = ({ children }) => {
  const { data, mutate: mutateExternalKnowledgeApis, isLoading } = useSWR<ExternalAPIListResponse>(
    { url: '/datasets/external-knowledge-api' },
    fetchExternalAPIList,
  )

  const contextValue = useMemo<ExternalKnowledgeApiContextType>(() => ({
    externalKnowledgeApiList: data?.data || [],
    mutateExternalKnowledgeApis,
    isLoading,
  }), [data, mutateExternalKnowledgeApis, isLoading])

  return (
    <ExternalKnowledgeApiContext.Provider value={contextValue}>
      {children}
    </ExternalKnowledgeApiContext.Provider>
  )
}

export { useExternalKnowledgeApi }
