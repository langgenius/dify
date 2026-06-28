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

  ModelTypeEnum,
} from './declarations'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  useMarketplacePlugins,
  useMarketplacePluginsByCollectionId,
} from '@/app/components/plugins/marketplace/hooks'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useLocale } from '@/context/i18n'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import {
  fetchDefaultModal,
  fetchModelList,
} from '@/service/common'
import { commonQueryKeys } from '@/service/use-common'
import { useExpandModelProviderList } from './atoms'
import {
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
} from './declarations'

type UseDefaultModelAndModelList = (
  defaultModel: DefaultModelResponse | undefined,
  modelList: Model[],
) => [DefaultModel | undefined, (model: DefaultModel) => void]
export const useSystemDefaultModelAndModelList: UseDefaultModelAndModelList = (
  defaultModel,
  modelList,
) => {
  const currentDefaultModel = useMemo(() => {
    const currentProvider = modelList.find(provider => provider.provider === defaultModel?.provider.provider)
    const currentModel = currentProvider?.models.find(model => model.model === defaultModel?.model)
    const currentDefaultModel = currentProvider && currentModel && {
      model: currentModel.model,
      provider: currentProvider.provider,
    }

    return currentDefaultModel
  }, [defaultModel, modelList])
  const currentDefaultModelKey = currentDefaultModel
    ? `${currentDefaultModel.provider}:${currentDefaultModel.model}`
    : ''
  const [defaultModelState, setDefaultModelState] = useState<DefaultModel | undefined>(currentDefaultModel)
  const [defaultModelSourceKey, setDefaultModelSourceKey] = useState(currentDefaultModelKey)
  const selectedDefaultModel = defaultModelSourceKey === currentDefaultModelKey
    ? defaultModelState
    : currentDefaultModel

  const handleDefaultModelChange = useCallback((model: DefaultModel) => {
    setDefaultModelSourceKey(currentDefaultModelKey)
    setDefaultModelState(model)
  }, [currentDefaultModelKey])

  return [selectedDefaultModel, handleDefaultModelChange]
}

export const useLanguage = () => {
  const locale = useLocale()
  return locale.replace('-', '_')
}
export const useModelList = (type: ModelTypeEnum) => {
  const { data, refetch, isPending } = useQuery({
    queryKey: commonQueryKeys.modelList(type),
    queryFn: () => fetchModelList(`/workspaces/current/models/model-types/${type}`),
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

export const useCurrentProviderAndModel = (modelList: Model[], defaultModel?: DefaultModel) => {
  const currentProvider = modelList.find(provider => provider.provider === defaultModel?.provider)
  const currentModel = currentProvider?.models.find(model => model.model === defaultModel?.model)

  return {
    currentProvider,
    currentModel,
  }
}

export const useTextGenerationCurrentProviderAndModelAndModelList = (defaultModel?: DefaultModel) => {
  const { textGenerationModelList } = useProviderContext()
  const activeTextGenerationModelList = textGenerationModelList.filter(model => model.status === ModelStatusEnum.active)
  const {
    currentProvider,
    currentModel,
  } = useCurrentProviderAndModel(textGenerationModelList, defaultModel)

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
  const { currentProvider, currentModel } = useCurrentProviderAndModel(
    modelList,
    { provider: defaultModel?.provider.provider || '', model: defaultModel?.model || '' },
  )

  return {
    modelList,
    defaultModel,
    currentProvider,
    currentModel,
  }
}

export const useUpdateModelList = () => {
  const queryClient = useQueryClient()

  const updateModelList = useCallback((type: ModelTypeEnum) => {
    queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelList(type) })
  }, [queryClient])

  return updateModelList
}

export const useInvalidateDefaultModel = () => {
  const queryClient = useQueryClient()

  return useCallback((type: ModelTypeEnum) => {
    queryClient.invalidateQueries({ queryKey: commonQueryKeys.defaultModel(type) })
  }, [queryClient])
}
export const useUpdateModelProviders = () => {
  const queryClient = useQueryClient()

  const updateModelProviders = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelProviders })
  }, [queryClient])

  return updateModelProviders
}

export const useMarketplaceAllPlugins = (providers: ModelProvider[], searchText: string, enabled = true) => {
  const exclude = useMemo(() => {
    return providers.map(provider => provider.provider.replace(/(.+)\/([^/]+)$/, '$1'))
  }, [providers])
  const {
    plugins: collectionPlugins = [],
    isLoading: isCollectionLoading,
  } = useMarketplacePluginsByCollectionId(enabled ? '__model-settings-pinned-models' : undefined)
  const {
    plugins,
    queryPlugins,
    queryPluginsWithDebounced,
    cancelQueryPluginsWithDebounced = () => {},
    resetPlugins = () => {},
    isLoading: isPluginsLoading,
  } = useMarketplacePlugins()

  useEffect(() => {
    if (!enabled) {
      cancelQueryPluginsWithDebounced()
      resetPlugins()
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
    }
    else {
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
  }, [cancelQueryPluginsWithDebounced, enabled, queryPlugins, queryPluginsWithDebounced, resetPlugins, searchText, exclude])

  const allPlugins = useMemo(() => {
    if (!enabled)
      return []

    const allPlugins = collectionPlugins.filter(plugin => !exclude.includes(plugin.plugin_id))

    if (plugins?.length) {
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]

        if (plugin!.type !== 'bundle' && !allPlugins.find(p => p.plugin_id === plugin!.plugin_id))
          allPlugins.push(plugin!)
      }
    }

    return allPlugins
  }, [enabled, plugins, collectionPlugins, exclude])

  return {
    plugins: enabled && searchText ? plugins : allPlugins,
    isLoading: enabled && (isCollectionLoading || isPluginsLoading),
  }
}

export const useRefreshModel = () => {
  const expandModelProviderList = useExpandModelProviderList()
  const queryClient = useQueryClient()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const handleRefreshModel = useCallback((
    provider: ModelProvider,
    CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
    refreshModelList?: boolean,
  ) => {
    const modelProviderModelListQueryKey = consoleQuery.modelProviders.models.queryKey({
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

    if (refreshModelList && provider.custom_configuration.status === CustomConfigurationStatusEnum.active) {
      expandModelProviderList(provider.provider)
      queryClient.invalidateQueries({
        queryKey: modelProviderModelListQueryKey,
        exact: true,
        refetchType: 'active',
      })

      if (CustomConfigurationModelFixedFields?.__model_type)
        updateModelList(CustomConfigurationModelFixedFields.__model_type)
    }
  }, [expandModelProviderList, queryClient, updateModelList, updateModelProviders])

  return {
    handleRefreshModel,
  }
}

export const useModelModalHandler = () => {
  const setShowModelModal = useModalContextSelector(state => state.setShowModelModal)

  return (
    provider: ModelProvider,
    configurationMethod: ConfigurationMethodEnum,
    CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
    extra: {
      isModelCredential?: boolean
      credential?: Credential
      model?: CustomModel
      onUpdate?: (newPayload: any, formValues?: Record<string, any>) => void
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
