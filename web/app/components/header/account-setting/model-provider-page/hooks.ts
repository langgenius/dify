import type {
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
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useLocale } from '@/context/i18n'
import { useModalContextSelector } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import {
  fetchDefaultModal,
  fetchModelList,
  fetchModelProviderCredentials,
  getPayUrl,
} from '@/service/common'
import { commonQueryKeys } from '@/service/use-common'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
} from './declarations'
import { UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST } from './provider-added-card'

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
  const [defaultModelState, setDefaultModelState] = useState<DefaultModel | undefined>(currentDefaultModel)
  const handleDefaultModelChange = useCallback((model: DefaultModel) => {
    setDefaultModelState(model)
  }, [])
  useEffect(() => {
    setDefaultModelState(currentDefaultModel)
  }, [currentDefaultModel])

  return [defaultModelState, handleDefaultModelChange]
}

export const useLanguage = () => {
  const locale = useLocale()
  return locale.replace('-', '_')
}

export const useProviderCredentialsAndLoadBalancing = (
  provider: string,
  configurationMethod: ConfigurationMethodEnum,
  configured?: boolean,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  credentialId?: string,
) => {
  const queryClient = useQueryClient()
  const predefinedEnabled = configurationMethod === ConfigurationMethodEnum.predefinedModel && configured && !!credentialId
  const customEnabled = configurationMethod === ConfigurationMethodEnum.customizableModel && !!currentCustomConfigurationModelFixedFields && !!credentialId

  const { data: predefinedFormSchemasValue, isPending: isPredefinedLoading } = useQuery(
    {
      queryKey: ['model-providers', 'credentials', provider, credentialId],
      queryFn: () => fetchModelProviderCredentials(`/workspaces/current/model-providers/${provider}/credentials${credentialId ? `?credential_id=${credentialId}` : ''}`),
      enabled: predefinedEnabled,
    },
  )
  const { data: customFormSchemasValue, isPending: isCustomizedLoading } = useQuery(
    {
      queryKey: ['model-providers', 'models', 'credentials', provider, currentCustomConfigurationModelFixedFields?.__model_type, currentCustomConfigurationModelFixedFields?.__model_name, credentialId],
      queryFn: () => fetchModelProviderCredentials(`/workspaces/current/model-providers/${provider}/models/credentials?model=${currentCustomConfigurationModelFixedFields?.__model_name}&model_type=${currentCustomConfigurationModelFixedFields?.__model_type}${credentialId ? `&credential_id=${credentialId}` : ''}`),
      enabled: customEnabled,
    },
  )

  const credentials = useMemo(() => {
    return configurationMethod === ConfigurationMethodEnum.predefinedModel
      ? predefinedFormSchemasValue?.credentials
      : customFormSchemasValue?.credentials
        ? {
            ...customFormSchemasValue?.credentials,
            ...currentCustomConfigurationModelFixedFields,
          }
        : undefined
  }, [
    configurationMethod,
    credentialId,
    currentCustomConfigurationModelFixedFields,
    customFormSchemasValue?.credentials,
    predefinedFormSchemasValue?.credentials,
  ])

  const mutate = useMemo(() => () => {
    if (predefinedEnabled)
      queryClient.invalidateQueries({ queryKey: ['model-providers', 'credentials', provider, credentialId] })
    if (customEnabled)
      queryClient.invalidateQueries({ queryKey: ['model-providers', 'models', 'credentials', provider, currentCustomConfigurationModelFixedFields?.__model_type, currentCustomConfigurationModelFixedFields?.__model_name, credentialId] })
  }, [customEnabled, credentialId, currentCustomConfigurationModelFixedFields?.__model_name, currentCustomConfigurationModelFixedFields?.__model_type, predefinedEnabled, provider, queryClient])

  return {
    credentials,
    loadBalancing: (configurationMethod === ConfigurationMethodEnum.predefinedModel
      ? predefinedFormSchemasValue
      : customFormSchemasValue
    )?.load_balancing,
    mutate,
    isLoading: isPredefinedLoading || isCustomizedLoading,
  }
  // as ([Record<string, string | boolean | undefined> | undefined, ModelLoadBalancingConfig | undefined])
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

export const useAnthropicBuyQuota = () => {
  const [loading, setLoading] = useState(false)

  const handleGetPayUrl = async () => {
    if (loading)
      return

    setLoading(true)
    try {
      const res = await getPayUrl('/workspaces/current/model-providers/anthropic/checkout-url')

      window.location.href = res.url
    }
    finally {
      setLoading(false)
    }
  }

  return handleGetPayUrl
}

export const useUpdateModelProviders = () => {
  const queryClient = useQueryClient()

  const updateModelProviders = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: commonQueryKeys.modelProviders })
  }, [queryClient])

  return updateModelProviders
}

export const useMarketplaceAllPlugins = (providers: ModelProvider[], searchText: string) => {
  const exclude = useMemo(() => {
    return providers.map(provider => provider.provider.replace(/(.+)\/([^/]+)$/, '$1'))
  }, [providers])
  const {
    plugins: collectionPlugins = [],
    isLoading: isCollectionLoading,
  } = useMarketplacePluginsByCollectionId('__model-settings-pinned-models')
  const {
    plugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading: isPluginsLoading,
  } = useMarketplacePlugins()

  useEffect(() => {
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
  }, [queryPlugins, queryPluginsWithDebounced, searchText, exclude])

  const allPlugins = useMemo(() => {
    const allPlugins = collectionPlugins.filter(plugin => !exclude.includes(plugin.plugin_id))

    if (plugins?.length) {
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]

        if (plugin.type !== 'bundle' && !allPlugins.find(p => p.plugin_id === plugin.plugin_id))
          allPlugins.push(plugin)
      }
    }

    return allPlugins
  }, [plugins, collectionPlugins, exclude])

  return {
    plugins: allPlugins,
    isLoading: isCollectionLoading || isPluginsLoading,
  }
}

export const useRefreshModel = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const handleRefreshModel = useCallback((
    provider: ModelProvider,
    CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
    refreshModelList?: boolean,
  ) => {
    updateModelProviders()

    provider.supported_model_types.forEach((type) => {
      updateModelList(type)
    })

    if (refreshModelList && provider.custom_configuration.status === CustomConfigurationStatusEnum.active) {
      eventEmitter?.emit({
        type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
        payload: provider.provider,
      } as any)

      if (CustomConfigurationModelFixedFields?.__model_type)
        updateModelList(CustomConfigurationModelFixedFields.__model_type)
    }
  }, [eventEmitter, updateModelList, updateModelProviders])

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
