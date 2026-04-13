import type { MutableRefObject } from 'react'
import type {
  KnowledgeRetrievalNodeType,
  MultipleRetrievalConfig,
} from '../types'
import type { ModelConfig } from '@/app/components/workflow/types'
import type { DataSet } from '@/models/datasets'
import { isEqual } from 'es-toolkit/predicate'
import { produce } from 'immer'
import {
  useCallback,
  useEffect,
} from 'react'
import { DATASET_DEFAULT } from '@/config'
import {
  AppModeEnum,
  RETRIEVE_TYPE,
} from '@/types/app'
import { getMultipleRetrievalConfig } from '../utils'

type ModelIdentity = {
  provider?: string
  model?: string
}

type TextProvider = {
  provider: string
}

type TextModel = {
  model: string
  model_properties?: {
    mode?: string
  }
}

type Params = {
  inputs: KnowledgeRetrievalNodeType
  inputRef: MutableRefObject<KnowledgeRetrievalNodeType>
  setInputs: (inputs: KnowledgeRetrievalNodeType) => void
  selectedDatasets: DataSet[]
  currentProvider?: TextProvider
  currentModel?: TextModel
  fallbackRerankModel: ModelIdentity
  hasRerankDefaultModel: boolean
}

const createSingleRetrievalConfig = (model: ModelConfig): KnowledgeRetrievalNodeType['single_retrieval_config'] => ({
  model,
})

const useKnowledgeModelConfig = ({
  inputs,
  inputRef,
  setInputs,
  selectedDatasets,
  currentProvider,
  currentModel,
  fallbackRerankModel,
  hasRerankDefaultModel,
}: Params) => {
  const handleModelChanged = useCallback((model: { provider: string, modelId: string, mode?: string }) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      if (!draft.single_retrieval_config) {
        draft.single_retrieval_config = createSingleRetrievalConfig({
          provider: '',
          name: '',
          mode: '',
          completion_params: {},
        })
      }

      const draftModel = draft.single_retrieval_config!.model
      draftModel.provider = model.provider
      draftModel.name = model.modelId
      draftModel.mode = model.mode || AppModeEnum.CHAT
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, unknown>) => {
    if (isEqual(newParams, inputRef.current.single_retrieval_config?.model.completion_params))
      return

    const nextInputs = produce(inputRef.current, (draft) => {
      if (!draft.single_retrieval_config) {
        draft.single_retrieval_config = createSingleRetrievalConfig({
          provider: '',
          name: '',
          mode: '',
          completion_params: {},
        })
      }

      draft.single_retrieval_config!.model.completion_params = newParams
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  useEffect(() => {
    const currentInputs = inputRef.current
    if (
      currentInputs.retrieval_mode === RETRIEVE_TYPE.multiWay
      && currentInputs.multiple_retrieval_config?.reranking_model?.provider
      && fallbackRerankModel.model
      && hasRerankDefaultModel
    ) {
      return
    }

    if (currentInputs.retrieval_mode === RETRIEVE_TYPE.oneWay && currentInputs.single_retrieval_config?.model?.provider)
      return

    const nextInputs = produce(currentInputs, (draft) => {
      if (currentProvider?.provider && currentModel?.model) {
        const hasSetModel = draft.single_retrieval_config?.model?.provider
        if (!hasSetModel) {
          draft.single_retrieval_config = createSingleRetrievalConfig({
            provider: currentProvider.provider,
            name: currentModel.model,
            mode: currentModel.model_properties?.mode || AppModeEnum.CHAT,
            completion_params: {},
          })
        }
      }

      const multipleRetrievalConfig = draft.multiple_retrieval_config
      draft.multiple_retrieval_config = {
        top_k: multipleRetrievalConfig?.top_k || DATASET_DEFAULT.top_k,
        score_threshold: multipleRetrievalConfig?.score_threshold,
        reranking_model: multipleRetrievalConfig?.reranking_model,
        reranking_mode: multipleRetrievalConfig?.reranking_mode,
        weights: multipleRetrievalConfig?.weights,
        reranking_enable: multipleRetrievalConfig?.reranking_enable !== undefined
          ? multipleRetrievalConfig.reranking_enable
          : Boolean(fallbackRerankModel.model && hasRerankDefaultModel),
      }
    })
    setInputs(nextInputs)
  }, [currentModel, currentProvider?.provider, fallbackRerankModel.model, hasRerankDefaultModel, inputRef, setInputs])

  const handleRetrievalModeChange = useCallback((newMode: RETRIEVE_TYPE) => {
    const nextInputs = produce(inputs, (draft) => {
      draft.retrieval_mode = newMode
      if (newMode === RETRIEVE_TYPE.multiWay) {
        draft.multiple_retrieval_config = getMultipleRetrievalConfig(
          draft.multiple_retrieval_config as MultipleRetrievalConfig,
          selectedDatasets,
          selectedDatasets,
          fallbackRerankModel,
        )
        return
      }

      const hasSetModel = draft.single_retrieval_config?.model?.provider
      if (!hasSetModel) {
        draft.single_retrieval_config = createSingleRetrievalConfig({
          provider: currentProvider?.provider || '',
          name: currentModel?.model || '',
          mode: currentModel?.model_properties?.mode || AppModeEnum.CHAT,
          completion_params: {},
        })
      }
    })
    setInputs(nextInputs)
  }, [currentModel?.model, currentModel?.model_properties?.mode, currentProvider?.provider, fallbackRerankModel, inputs, selectedDatasets, setInputs])

  const handleMultipleRetrievalConfigChange = useCallback((newConfig: MultipleRetrievalConfig) => {
    const nextInputs = produce(inputs, (draft) => {
      draft.multiple_retrieval_config = getMultipleRetrievalConfig(
        newConfig,
        selectedDatasets,
        selectedDatasets,
        fallbackRerankModel,
      )
    })
    setInputs(nextInputs)
  }, [fallbackRerankModel, inputs, selectedDatasets, setInputs])

  return {
    handleModelChanged,
    handleCompletionParamsChange,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
  }
}

export default useKnowledgeModelConfig
