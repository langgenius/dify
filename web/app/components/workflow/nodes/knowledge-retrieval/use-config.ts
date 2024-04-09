import { useCallback, useEffect, useRef, useState } from 'react'
import produce from 'immer'
import { isEqual } from 'lodash-es'
import type { ValueSelector, Var } from '../../types'
import { BlockEnum, VarType } from '../../types'
import {
  useIsChatMode, useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import type { KnowledgeRetrievalNodeType, MultipleRetrievalConfig } from './types'
import { RETRIEVE_TYPE } from '@/types/app'
import { DATASET_DEFAULT } from '@/config'
import type { DataSet } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

const useConfig = (id: string, payload: KnowledgeRetrievalNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const startNode = getBeforeNodesInSameBranch(id).find(node => node.data.type === BlockEnum.Start)
  const startNodeId = startNode?.id
  const { inputs, setInputs: doSetInputs } = useNodeCrud<KnowledgeRetrievalNodeType>(id, payload)

  const setInputs = useCallback((s: KnowledgeRetrievalNodeType) => {
    const newInputs = produce(s, (draft) => {
      if (s.retrieval_mode === RETRIEVE_TYPE.multiWay)
        delete draft.single_retrieval_config
      else
        delete draft.multiple_retrieval_config
    })
    // not work in pass to draft...
    doSetInputs(newInputs)
  }, [doSetInputs])

  const inputRef = useRef(inputs)
  useEffect(() => {
    inputRef.current = inputs
  }, [inputs])

  const handleQueryVarChange = useCallback((newVar: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query_variable_selector = newVar as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  const {
    defaultModel: rerankDefaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputRef.current, (draft) => {
      if (!draft.single_retrieval_config) {
        draft.single_retrieval_config = {
          model: {
            provider: '',
            name: '',
            mode: '',
            completion_params: {},
          },
        }
      }
      const draftModel = draft.single_retrieval_config?.model
      draftModel.provider = model.provider
      draftModel.name = model.modelId
      draftModel.mode = model.mode!
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    // inputRef.current.single_retrieval_config?.model is old  when change the provider...
    if (isEqual(newParams, inputRef.current.single_retrieval_config?.model.completion_params))
      return

    const newInputs = produce(inputRef.current, (draft) => {
      if (!draft.single_retrieval_config) {
        draft.single_retrieval_config = {
          model: {
            provider: '',
            name: '',
            mode: '',
            completion_params: {},
          },
        }
      }
      draft.single_retrieval_config.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [setInputs])

  // set defaults models
  useEffect(() => {
    const inputs = inputRef.current
    if (inputs.retrieval_mode === RETRIEVE_TYPE.multiWay && inputs.multiple_retrieval_config?.reranking_model?.provider)
      return

    if (inputs.retrieval_mode === RETRIEVE_TYPE.oneWay && inputs.single_retrieval_config?.model?.provider)
      return

    const newInput = produce(inputs, (draft) => {
      if (currentProvider?.provider && currentModel?.model) {
        const hasSetModel = draft.single_retrieval_config?.model?.provider
        if (!hasSetModel) {
          draft.single_retrieval_config = {
            model: {
              provider: currentProvider?.provider,
              name: currentModel?.model,
              mode: currentModel?.model_properties?.mode as string,
              completion_params: {},
            },
          }
        }
      }

      const multipleRetrievalConfig = draft.multiple_retrieval_config
      draft.multiple_retrieval_config = {
        top_k: multipleRetrievalConfig?.top_k || DATASET_DEFAULT.top_k,
        score_threshold: multipleRetrievalConfig?.score_threshold,
        reranking_model: payload.retrieval_mode === RETRIEVE_TYPE.oneWay
          ? undefined
          : (!multipleRetrievalConfig?.reranking_model?.provider
            ? {
              provider: rerankDefaultModel?.provider?.provider || '',
              model: rerankDefaultModel?.model || '',
            }
            : multipleRetrievalConfig?.reranking_model),
      }
    })
    setInputs(newInput)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProvider?.provider, currentModel, rerankDefaultModel])

  const handleRetrievalModeChange = useCallback((newMode: RETRIEVE_TYPE) => {
    const newInputs = produce(inputs, (draft) => {
      draft.retrieval_mode = newMode
      if (newMode === RETRIEVE_TYPE.multiWay) {
        draft.multiple_retrieval_config = {
          top_k: draft.multiple_retrieval_config?.top_k || DATASET_DEFAULT.top_k,
          score_threshold: draft.multiple_retrieval_config?.score_threshold,
          reranking_model: !draft.multiple_retrieval_config?.reranking_model?.provider
            ? {
              provider: rerankDefaultModel?.provider?.provider || '',
              model: rerankDefaultModel?.model || '',
            }
            : draft.multiple_retrieval_config?.reranking_model,
        }
      }
      else {
        const hasSetModel = draft.single_retrieval_config?.model?.provider
        if (!hasSetModel) {
          draft.single_retrieval_config = {
            model: {
              provider: currentProvider?.provider || '',
              name: currentModel?.model || '',
              mode: currentModel?.model_properties?.mode as string,
              completion_params: {},
            },
          }
        }
      }
    })
    setInputs(newInputs)
  }, [currentModel?.model, currentModel?.model_properties?.mode, currentProvider?.provider, inputs, rerankDefaultModel?.model, rerankDefaultModel?.provider?.provider, setInputs])

  const handleMultipleRetrievalConfigChange = useCallback((newConfig: MultipleRetrievalConfig) => {
    const newInputs = produce(inputs, (draft) => {
      draft.multiple_retrieval_config = newConfig
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // datasets
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  useEffect(() => {
    (async () => {
      const inputs = inputRef.current
      const datasetIds = inputs.dataset_ids
      if (datasetIds?.length > 0) {
        const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } })
        setSelectedDatasets(dataSetsWithDetail)
      }
      const newInputs = produce(inputs, (draft) => {
        draft.dataset_ids = datasetIds
      })
      setInputs(newInputs)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let query_variable_selector: ValueSelector = inputs.query_variable_selector
    if (isChatMode && inputs.query_variable_selector.length === 0 && startNodeId)
      query_variable_selector = [startNodeId, 'sys.query']

    setInputs({
      ...inputs,
      query_variable_selector,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOnDatasetsChange = useCallback((newDatasets: DataSet[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.dataset_ids = newDatasets.map(d => d.id)
    })
    setInputs(newInputs)
    setSelectedDatasets(newDatasets)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.string
  }, [])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<KnowledgeRetrievalNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {
      query: '',
    },
  })

  const query = runInputData.query
  const setQuery = useCallback((newQuery: string) => {
    setRunInputData({
      ...runInputData,
      query: newQuery,
    })
  }, [runInputData, setRunInputData])

  return {
    readOnly,
    inputs,
    handleQueryVarChange,
    filterVar,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    handleModelChanged,
    handleCompletionParamsChange,
    selectedDatasets,
    handleOnDatasetsChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    query,
    setQuery,
    runResult,
  }
}

export default useConfig
