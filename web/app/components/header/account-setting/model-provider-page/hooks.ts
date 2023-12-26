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
} from './declarations'
import {
  ConfigurateMethodEnum,
  ModelTypeEnum,
} from './declarations'
import { languageMaps } from './utils'
import I18n from '@/context/i18n'
import {
  fetchDefaultModal,
  fetchModelList,
  fetchModelProviderCredentials,
} from '@/service/common'

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

  return languageMaps[locale]
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

  return configurateMethod === ConfigurateMethodEnum.predefinedModel
    ? predefinedFormSchemasValue?.credentials
    : customFormSchemasValue?.credentials
      ? {
        ...customFormSchemasValue?.credentials,
        ...currentCustomConfigrationModelFixedFields,
      }
      : undefined
}

export type ModelTypeIndex = 1 | 2 | 3 | 4
export const MODEL_TYPE_MAPS = {
  1: ModelTypeEnum.textGeneration,
  2: ModelTypeEnum.textEmbedding,
  3: ModelTypeEnum.rerank,
  4: ModelTypeEnum.speech2text,
}

export const useModelList = (type: ModelTypeIndex) => {
  const { data, mutate, isLoading } = useSWR(`/workspaces/current/models/model-types/${MODEL_TYPE_MAPS[type]}`, fetchModelList)

  return {
    data: data?.data || [],
    mutate,
    isLoading,
  }
}

export const useDefaultModel = (type: ModelTypeIndex) => {
  const { data, mutate, isLoading } = useSWR(`/workspaces/current/default-model?model_type=${MODEL_TYPE_MAPS[type]}`, fetchDefaultModal)

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

export const useModelListAndDefaultModel = (type: ModelTypeIndex) => {
  const { data: modelList } = useModelList(type)
  const { data: defaultModel } = useDefaultModel(type)

  return {
    modelList,
    defaultModel,
  }
}

export const useModelListAndDefaultModelAndCurrentProviderAndModel = (type: ModelTypeIndex) => {
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

  const updateModelList = useCallback((type: ModelTypeIndex | ModelTypeEnum) => {
    const modelType = typeof type === 'number' ? MODEL_TYPE_MAPS[type] : type
    mutate(`/workspaces/current/models/model-types/${modelType}`)
  }, [mutate])

  return updateModelList
}
