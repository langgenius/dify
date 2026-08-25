import type { ModelType } from '@dify/contracts/api/console/workspaces/types.gen'
import type {
  ConfigurationMethodEnum,
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  DefaultModel,
  DefaultModelResponse,
  Model,
  ModelModalModeEnum,
  ModelProvider,
} from './declarations'
import type { ModelModalType } from '@/context/modal-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useMarketplacePlugins,
  useMarketplacePluginsByCollectionId,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useLocale } from '@/context/i18n'
import { useModalContextSelector } from '@/context/modal-context'
import { consoleQuery } from '@/service/client'
import { fetchDefaultModal, fetchModelList } from '@/service/common'
import { commonQueryKeys, modelProviderDetailsQueryOptions } from '@/service/use-common'
import { useExpandModelProviderList } from './atoms'
import { CustomConfigurationStatusEnum, ModelStatusEnum, ModelTypeEnum } from './declarations'

type UseDefaultModelAndModelList = (
  defaultModel: DefaultModelResponse | undefined,
  modelList: Model[],
) => [DefaultModel | undefined, (model: DefaultModel) => void]
export const useSystemDefaultModelAndModelList: UseDefaultModelAndModelList = (
  defaultModel,
  modelList,
) => {
  const currentDefaultModel = useMemo(() => {
    const currentProvider = modelList.find(
      (provider) => provider.provider === defaultModel?.provider.provider,
    )
    const currentModel = currentProvider?.models.find(
      (model) => model.model === defaultModel?.model,
    )
    const currentDefaultModel = currentProvider &&
      currentModel && {
        model: currentModel.model,
        provider: currentProvider.provider,
      }

    return currentDefaultModel
  }, [defaultModel, modelList])
  const currentDefaultModelKey = currentDefaultModel
    ? `${currentDefaultModel.provider}:${currentDefaultModel.model}`
    : ''
  const [defaultModelState, setDefaultModelState] = useState<DefaultModel | undefined>(
    currentDefaultModel,
  )
  const [defaultModelSourceKey, setDefaultModelSourceKey] = useState(currentDefaultModelKey)
  const selectedDefaultModel =
    defaultModelSourceKey === currentDefaultModelKey ? defaultModelState : currentDefaultModel

  const handleDefaultModelChange = useCallback(
    (model: DefaultModel) => {
      setDefaultModelSourceKey(currentDefaultModelKey)
      setDefaultModelState(model)
    },
    [currentDefaultModelKey],
  )

  return [selectedDefaultModel, handleDefaultModelChange]
}

export const useLanguage = () => {
  const locale = useLocale()
  return locale.replace('-', '_')
}

type UseModelListOptions = {
  enabled?: boolean
}

export const useModelList = (type: ModelTypeEnum, { enabled = true }: UseModelListOptions = {}) => {
  const { data, refetch, isPending } = useQuery({
    queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: {
        params: {
          model_type: type,
        },
      },
    }),
    queryFn: () => fetchModelList(`/workspaces/current/models/model-types/${type}`),
    enabled,
  })

  return {
    data: data?.data || [],
    mutate: refetch,
    isLoading: isPending,
  }
}

export const useDefaultModel = (type: ModelTypeEnum) => {
  const { data, refetch, isPending } = useQuery({
    queryKey: commonQueryKeys.defaultModel(type),
    queryFn: () => fetchDefaultModal(`/workspaces/current/default-model?model_type=${type}`),
  })

  return {
    data: data?.data,
    mutate: refetch,
    isLoading: isPending,
  }
}

type ModelFromProvider<TProvider> = TProvider extends { models: Array<infer TModel> }
  ? TModel
  : never

export const getCurrentProviderAndModel = <
  TProvider extends { models: Array<{ model: string }>; provider: string },
>(
  modelList: TProvider[],
  defaultModel?: DefaultModel,
) => {
  const currentProvider = modelList.find((provider) => provider.provider === defaultModel?.provider)
  const currentModel = currentProvider?.models.find(
    (model) => model.model === defaultModel?.model,
  ) as ModelFromProvider<TProvider> | undefined

  return {
    currentProvider,
    currentModel,
  }
}

export { getCurrentProviderAndModel as useCurrentProviderAndModel }

export const useTextGenerationCurrentProviderAndModelAndModelList = (
  defaultModel?: DefaultModel,
) => {
  const { data: textGenerationModelList } = useModelList(ModelTypeEnum.textGeneration)
  const activeTextGenerationModelList = textGenerationModelList.filter(
    (model) => model.status === ModelStatusEnum.active,
  )
  const { currentProvider, currentModel } = getCurrentProviderAndModel(
    textGenerationModelList,
    defaultModel,
  )

  return {
    currentProvider,
    currentModel,
    textGenerationModelList,
    activeTextGenerationModelList,
  }
}

export const useModelListAndDefaultModel = (type: ModelTypeEnum) => {
  const { data: modelList } = useModelList(type)
  const { data: defaultModel } = useDefaultModel(type)

  return {
    modelList,
    defaultModel,
  }
}

export const useModelListAndDefaultModelAndCurrentProviderAndModel = (type: ModelTypeEnum) => {
  const { modelList, defaultModel } = useModelListAndDefaultModel(type)
  const { currentProvider, currentModel } = getCurrentProviderAndModel(modelList, {
    provider: defaultModel?.provider.provider || '',
    model: defaultModel?.model || '',
  })

  return {
    modelList,
    defaultModel,
    currentProvider,
    currentModel,
  }
}

export const useUpdateModelList = () => {
  const queryClient = useQueryClient()

  const updateModelList = useCallback(
    (type: ModelTypeEnum | ModelType) => {
      queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
          input: {
            params: {
              model_type: type,
            },
          },
        }),
      })
    },
    [queryClient],
  )

  return updateModelList
}

export const useInvalidateDefaultModel = () => {
  const queryClient = useQueryClient()

  return useCallback(
    (type: ModelTypeEnum) => {
      queryClient.invalidateQueries({ queryKey: commonQueryKeys.defaultModel(type) })
    },
    [queryClient],
  )
}
export const useUpdateModelProviders = () => {
  const queryClient = useQueryClient()

  const updateModelProviders = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: consoleQuery.workspaces.current.modelProviders.summary.get.key(),
    })
    queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelProviderDetails })
  }, [queryClient])

  return updateModelProviders
}

export const useLazyModelProviderDetail = (providerName: string) => {
  const [enabled, setEnabled] = useState(false)
  const queryClient = useQueryClient()
  const { data, isFetching } = useQuery({
    ...modelProviderDetailsQueryOptions(),
    enabled,
  })
  const providerDetail = data?.data.find((provider) => provider.provider === providerName)

  const loadProviderDetail = useCallback(async () => {
    setEnabled(true)
    try {
      const response = await queryClient.fetchQuery(modelProviderDetailsQueryOptions())
      return response.data.find((provider) => provider.provider === providerName)
    } catch {
      return undefined
    }
  }, [providerName, queryClient])

  return {
    providerDetail,
    loadProviderDetail,
    isProviderDetailEnabled: enabled,
    isLoadingProviderDetail: enabled && isFetching,
  }
}

export const useMarketplaceAllPlugins = (
  searchText: string,
  installedPluginIds: string[],
  enabled = true,
) => {
  const exclude = installedPluginIds
  const { plugins: collectionPlugins = [], isLoading: isCollectionLoading } =
    useMarketplacePluginsByCollectionId(enabled ? '__model-settings-pinned-models' : undefined)
  const {
    plugins,
    queryPlugins,
    queryPluginsWithDebounced,
    cancelQueryPluginsWithDebounced = () => {},
    isLoading: isPluginsLoading,
  } = useMarketplacePlugins(enabled)

  useEffect(() => {
    if (!enabled) {
      cancelQueryPluginsWithDebounced()
      return
    }

    if (searchText) {
      queryPluginsWithDebounced({
        query: searchText,
        category: PluginCategoryEnum.model,
        exclude,
        type: 'plugin',
        sort_by: 'install_count',
        sort_order: 'DESC',
      })
    } else {
      queryPlugins({
        query: '',
        category: PluginCategoryEnum.model,
        type: 'plugin',
        page_size: 1000,
        exclude,
        sort_by: 'install_count',
        sort_order: 'DESC',
      })
    }
  }, [
    cancelQueryPluginsWithDebounced,
    enabled,
    queryPlugins,
    queryPluginsWithDebounced,
    searchText,
    exclude,
  ])

  const allPlugins = useMemo(() => {
    if (!enabled) return []

    const allPlugins = collectionPlugins.filter((plugin) => !exclude.includes(plugin.plugin_id))

    if (plugins?.length) {
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]

        if (
          !exclude.includes(plugin!.plugin_id) &&
          plugin!.type !== 'bundle' &&
          !allPlugins.find((p) => p.plugin_id === plugin!.plugin_id)
        )
          allPlugins.push(plugin!)
      }
    }

    return allPlugins
  }, [enabled, plugins, collectionPlugins, exclude])

  return {
    plugins:
      enabled && searchText
        ? plugins?.filter((plugin) => !exclude.includes(plugin.plugin_id))
        : allPlugins,
    isLoading: enabled && (isCollectionLoading || isPluginsLoading),
  }
}

export const useRefreshModel = () => {
  const expandModelProviderList = useExpandModelProviderList()
  const queryClient = useQueryClient()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const handleRefreshModel = useCallback(
    (
      provider: ModelProvider,
      CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
      refreshModelList?: boolean,
    ) => {
      const modelProviderModelListQueryKey =
        consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryKey({
          input: {
            params: {
              provider: provider.provider,
            },
          },
        })
      queryClient.invalidateQueries({
        queryKey: modelProviderModelListQueryKey,
        exact: true,
        refetchType: 'none',
      })

      updateModelProviders()

      provider.supported_model_types.forEach((type) => {
        updateModelList(type)
      })

      if (
        refreshModelList &&
        provider.custom_configuration.status === CustomConfigurationStatusEnum.active
      ) {
        expandModelProviderList(provider.provider)
        queryClient.invalidateQueries({
          queryKey: modelProviderModelListQueryKey,
          exact: true,
          refetchType: 'active',
        })

        if (CustomConfigurationModelFixedFields?.__model_type)
          updateModelList(CustomConfigurationModelFixedFields.__model_type)
      }
    },
    [expandModelProviderList, queryClient, updateModelList, updateModelProviders],
  )

  return {
    handleRefreshModel,
  }
}

export const useModelModalHandler = () => {
  const setShowModelModal = useModalContextSelector((state) => state.setShowModelModal)

  return (
    provider: ModelProvider,
    configurationMethod: ConfigurationMethodEnum,
    CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
    extra: {
      isModelCredential?: boolean
      credential?: Credential
      model?: CustomModel
      onUpdate?: (newPayload?: ModelModalType, formValues?: Record<string, unknown>) => void
      mode?: ModelModalModeEnum
    } = {},
  ) => {
    setShowModelModal({
      payload: {
        currentProvider: provider,
        currentConfigurationMethod: configurationMethod,
        currentCustomConfigurationModelFixedFields: CustomConfigurationModelFixedFields,
        isModelCredential: extra.isModelCredential,
        credential: extra.credential,
        model: extra.model,
        mode: extra.mode,
      },
      onSaveCallback: (newPayload, formValues) => {
        extra.onUpdate?.(newPayload, formValues)
      },
    })
  }
}
