import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from './declarations'

type UseDefaultModelAndModelList = (
  defaultModel: DefaultModel | undefined,
  modelList: Model[],
) => [ModelItem | undefined, (model: ModelItem) => void]
export const useDefaultModelAndModelList: UseDefaultModelAndModelList = (
  defaultModel,
  modelList,
) => {
  const currentDefaultModel = useMemo(() => {
    const currentDefaultModel: ModelItem | undefined = modelList.find(provider => provider.provider === defaultModel?.provider.provider)?.models.find(model => model.model === defaultModel?.model)

    return currentDefaultModel
  }, [defaultModel, modelList])
  const [defaultModelState, setDefaultModelState] = useState(currentDefaultModel)
  const handleDefaultModelChange = useCallback((model: ModelItem) => {
    setDefaultModelState(model)
  }, [])
  useEffect(() => {
    setDefaultModelState(currentDefaultModel)
  }, [currentDefaultModel])

  return [defaultModelState, handleDefaultModelChange]
}
