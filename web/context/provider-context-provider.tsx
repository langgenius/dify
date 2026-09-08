'use client'

import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ModelStatusEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys, useModelListByType } from '@/service/use-common'
import { ProviderContext } from './provider-context'

type ProviderContextProviderProps = {
  children: ReactNode
}

export const ProviderContextProvider = ({ children }: ProviderContextProviderProps) => {
  const queryClient = useQueryClient()
  const {
    data: providersData,
    isLoading: isLoadingModelProviders,
    isSuccess: isSuccessModelProviders,
  } = useQuery(consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions())
  const { data: textGenerationModelList } = useModelListByType(ModelTypeEnum.textGeneration)

  const refreshModelProviders = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
      }),
      queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelProviderDetails }),
    ]).then(() => undefined)

  return (
    <ProviderContext.Provider
      value={{
        modelProviders: providersData?.data || [],
        modelProviderPlugins: providersData?.plugins || {},
        isLoadingModelProviders,
        isSuccessModelProviders,
        refreshModelProviders,
        textGenerationModelList: textGenerationModelList?.data || [],
        isAPIKeySet: !!textGenerationModelList?.data?.some(
          (model) => model.status === ModelStatusEnum.active,
        ),
      }}
    >
      {children}
    </ProviderContext.Provider>
  )
}
