import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import useSWR from 'swr'
import { useContext } from 'use-context-selector'
import type {
  CustomConfigrationModelFixedFields,
  DefaultModel,
  DefaultModelResponse,
  Model,
} from './declarations'
import { ConfigurateMethodEnum } from './declarations'
import { languageMaps } from './utils'
import I18n from '@/context/i18n'
import { fetchModelProviderCredentials } from '@/service/common'

type UseDefaultModelAndModelList = (
  defaultModel: DefaultModelResponse | undefined,
  modelList: Model[],
) => [DefaultModel | undefined, (model: DefaultModel) => void]
export const useDefaultModelAndModelList: UseDefaultModelAndModelList = (
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
