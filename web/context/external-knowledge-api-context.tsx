'use client'

import type { FC, ReactNode } from 'react'
import type { ExternalAPIItem, ExternalAPIListResponse } from '@/models/datasets'
import { createContext, useCallback, useContext, useMemo } from 'react'
import { useExternalKnowledgeApiList } from '@/service/knowledge/use-dataset'

type ExternalKnowledgeApiContextType = {
  externalKnowledgeApiList: ExternalAPIItem[]
  mutateExternalKnowledgeApis: () => Promise<ExternalAPIListResponse | undefined>
  isLoading: boolean
}

const ExternalKnowledgeApiContext = createContext<ExternalKnowledgeApiContextType | undefined>(undefined)

export type ExternalKnowledgeApiProviderProps = {
  children: ReactNode
}

export const ExternalKnowledgeApiProvider: FC<ExternalKnowledgeApiProviderProps> = ({ children }) => {
  const { data, refetch, isLoading } = useExternalKnowledgeApiList()

  const mutateExternalKnowledgeApis = useCallback(() => {
    return refetch().then(res => res.data)
  }, [refetch])

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
  const context = useContext(ExternalKnowledgeApiContext)
  if (context === undefined)
    throw new Error('useExternalKnowledgeApi must be used within a ExternalKnowledgeApiProvider')

  return context
}
