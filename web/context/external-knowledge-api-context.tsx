'use client'

import type { FC, ReactNode } from 'react'
import type { ExternalAPIItem, ExternalAPIListResponse } from '@/models/datasets'
import { createContext, use, useCallback, useMemo } from 'react'
import { useExternalKnowledgeApiList } from '@/service/knowledge/use-dataset'

type ExternalKnowledgeApiContextType = {
  externalKnowledgeApiList: ExternalAPIItem[]
  mutateExternalKnowledgeApis: () => Promise<ExternalAPIListResponse | undefined>
  isLoading: boolean
}

const ExternalKnowledgeApiContext = createContext<ExternalKnowledgeApiContextType | undefined>(undefined)

type ExternalKnowledgeApiProviderProps = {
  children: ReactNode
  enabled?: boolean
}

export const ExternalKnowledgeApiProvider: FC<ExternalKnowledgeApiProviderProps> = ({ children, enabled = true }) => {
  const { data, refetch, isLoading } = useExternalKnowledgeApiList({ enabled })

  const mutateExternalKnowledgeApis = useCallback(() => {
    if (!enabled)
      return Promise.resolve(undefined)

    return refetch().then(res => res.data)
  }, [enabled, refetch])

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

export const useExternalKnowledgeApi = () => {
  const context = use(ExternalKnowledgeApiContext)
  if (context === undefined)
    throw new Error('useExternalKnowledgeApi must be used within a ExternalKnowledgeApiProvider')

  return context
}
