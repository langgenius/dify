import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useContext } from 'use-context-selector'
import type {
  CustomConfigrationModelFixedFields,
  DefaultModel,
  DefaultModelResponse,
  Model,
  ModelTypeEnum,
} from './declarations'
import {
  ConfigurateMethodEnum,
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

export const useProviderCrenditialsFormSchemasValue = (
  provider: string,
  configurateMethod: ConfigurateMethodEnum,
  configured?: boolean,
  currentCustomConfigrationModelFixedFields?: CustomConfigrationModelFixedFields,
) => {
  const { data: predefinedFormSchemasValue } = useSWR(
    (configurateMethod === ConfigurateMethodEnum.predefinedModel && configured)
      ? `/workspaces/current/model-providers/${provider}/credentials`
      : null,
    fetchModelProviderCredentials,
  )
  const { data: customFormSchemasValue } = useSWR(
    (configurateMethod === ConfigurateMethodEnum.customizableModel && currentCustomConfigrationModelFixedFields)
      ? `/workspaces/current/model-providers/${provider}/models/credentials?model=${currentCustomConfigrationModelFixedFields?.__model_name}&model_type=${currentCustomConfigrationModelFixedFields?.__model_type}`
      : null,
    fetchModelProviderCredentials,
  )

  const value = useMemo(() => {
    return configurateMethod === ConfigurateMethodEnum.predefinedModel
      ? predefinedFormSchemasValue?.credentials
      : customFormSchemasValue?.credentials
        ? {
          ...customFormSchemasValue?.credentials,
          ...currentCustomConfigrationModelFixedFields,
        }
        : undefined
  }, [
    configurateMethod,
    currentCustomConfigrationModelFixedFields,
    customFormSchemasValue?.credentials,
    predefinedFormSchemasValue?.credentials,
  ])

  return value
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
