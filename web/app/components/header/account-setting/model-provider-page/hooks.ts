import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useContext } from 'use-context-selector'
import type {
  CustomConfigurationModelFixedFields,
  DefaultModel,
  DefaultModelResponse,
  Model,
  ModelProvider,
  ModelTypeEnum,
} from './declarations'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  ModelStatusEnum,
} from './declarations'
import I18n from '@/context/i18n'
import {
  fetchDefaultModal,
  fetchModelList,
  fetchModelProviderCredentials,
  fetchModelProviders,
  getPayUrl,
} from '@/service/common'
import { useProviderContext } from '@/context/provider-context'
import {
  useMarketplacePlugins,
} from '@/app/components/plugins/marketplace/hooks'
import type { Plugin } from '@/app/components/plugins/types'
import { PluginType } from '@/app/components/plugins/types'
import { getMarketplacePluginsByCollectionId } from '@/app/components/plugins/marketplace/utils'
import { useModalContextSelector } from '@/context/modal-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'
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
  const { locale } = useContext(I18n)
  return locale.replace('-', '_')
}

export const useProviderCredentialsAndLoadBalancing = (
  provider: string,
  configurationMethod: ConfigurationMethodEnum,
  configured?: boolean,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
) => {
  const { data: predefinedFormSchemasValue, mutate: mutatePredefined } = useSWR(
    (configurationMethod === ConfigurationMethodEnum.predefinedModel && configured)
      ? `/workspaces/current/model-providers/${provider}/credentials`
      : null,
    fetchModelProviderCredentials,
  )
  const { data: customFormSchemasValue, mutate: mutateCustomized } = useSWR(
    (configurationMethod === ConfigurationMethodEnum.customizableModel && currentCustomConfigurationModelFixedFields)
      ? `/workspaces/current/model-providers/${provider}/models/credentials?model=${currentCustomConfigurationModelFixedFields?.__model_name}&model_type=${currentCustomConfigurationModelFixedFields?.__model_type}`
      : null,
    fetchModelProviderCredentials,
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
    currentCustomConfigurationModelFixedFields,
    customFormSchemasValue?.credentials,
    predefinedFormSchemasValue?.credentials,
  ])

  const mutate = useMemo(() => () => {
    mutatePredefined()
    mutateCustomized()
  }, [mutateCustomized, mutatePredefined])

  return {
    credentials,
    loadBalancing: (configurationMethod === ConfigurationMethodEnum.predefinedModel
      ? predefinedFormSchemasValue
      : customFormSchemasValue
    )?.load_balancing,
    mutate,
  }
  // as ([Record<string, string | boolean | undefined> | undefined, ModelLoadBalancingConfig | undefined])
}

export const useModelList = (type: ModelTypeEnum) => {
  const { data, mutate, isLoading } = useSWR(`/workspaces/current/models/model-types/${type}`, fetchModelList)

  return {
    data: data?.data || [],
    mutate,
    isLoading,
  }
}

export const useDefaultModel = (type: ModelTypeEnum) => {
  const { data, mutate, isLoading } = useSWR(`/workspaces/current/default-model?model_type=${type}`, fetchDefaultModal)

  return {
    data: data?.data,
    mutate,
    isLoading,
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
  const { mutate } = useSWRConfig()

  const updateModelList = useCallback((type: ModelTypeEnum) => {
    mutate(`/workspaces/current/models/model-types/${type}`)
  }, [mutate])

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

export const useModelProviders = () => {
  const { data: providersData, mutate, isLoading } = useSWR('/workspaces/current/model-providers', fetchModelProviders)

  return {
    data: providersData?.data || [],
    mutate,
    isLoading,
  }
}

export const useUpdateModelProviders = () => {
  const { mutate } = useSWRConfig()

  const updateModelProviders = useCallback(() => {
    mutate('/workspaces/current/model-providers')
  }, [mutate])

  return updateModelProviders
}

export const useMarketplaceAllPlugins = (providers: ModelProvider[], searchText: string) => {
  const exclude = useMemo(() => {
    return providers.map(provider => provider.provider.replace(/(.+)\/([^/]+)$/, '$1'))
  }, [providers])
  const [collectionPlugins, setCollectionPlugins] = useState<Plugin[]>([])

  const {
    plugins,
    queryPlugins,
    queryPluginsWithDebounced,
    isLoading,
  } = useMarketplacePlugins()

  const getCollectionPlugins = useCallback(async () => {
    const collectionPlugins = await getMarketplacePluginsByCollectionId('__model-settings-pinned-models')

    setCollectionPlugins(collectionPlugins)
  }, [])

  useEffect(() => {
    getCollectionPlugins()
  }, [getCollectionPlugins])

  useEffect(() => {
    if (searchText) {
      queryPluginsWithDebounced({
        query: searchText,
        category: PluginType.model,
        exclude,
        type: 'plugin',
        sortBy: 'install_count',
        sortOrder: 'DESC',
      })
    }
    else {
      queryPlugins({
        query: '',
        category: PluginType.model,
        type: 'plugin',
        pageSize: 1000,
        exclude,
        sortBy: 'install_count',
        sortOrder: 'DESC',
      })
    }
  }, [queryPlugins, queryPluginsWithDebounced, searchText, exclude])

  const allPlugins = useMemo(() => {
    const allPlugins = [...collectionPlugins.filter(plugin => !exclude.includes(plugin.plugin_id))]

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
    isLoading,
  }
}

export const useModelModalHandler = () => {
  const setShowModelModal = useModalContextSelector(state => state.setShowModelModal)
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { eventEmitter } = useEventEmitterContextContext()

  return (
    provider: ModelProvider,
    configurationMethod: ConfigurationMethodEnum,
    CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  ) => {
    setShowModelModal({
      payload: {
        currentProvider: provider,
        currentConfigurationMethod: configurationMethod,
        currentCustomConfigurationModelFixedFields: CustomConfigurationModelFixedFields,
      },
      onSaveCallback: () => {
        updateModelProviders()

        provider.supported_model_types.forEach((type) => {
          updateModelList(type)
        })

        if (configurationMethod === ConfigurationMethodEnum.customizableModel
            && provider.custom_configuration.status === CustomConfigurationStatusEnum.active) {
          eventEmitter?.emit({
            type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
            payload: provider.provider,
          } as any)

          if (CustomConfigurationModelFixedFields?.__model_type)
            updateModelList(CustomConfigurationModelFixedFields.__model_type)
        }
      },
    })
  }
}
