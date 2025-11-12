import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { produce } from 'immer'
import { isEqual } from 'lodash-es'
import { v4 as uuid4 } from 'uuid'
import type { ValueSelector, Var } from '../../types'
import { BlockEnum, VarType } from '../../types'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import type {
  HandleAddCondition,
  HandleRemoveCondition,
  HandleToggleConditionLogicalOperator,
  HandleUpdateCondition,
  KnowledgeRetrievalNodeType,
  MetadataFilteringModeEnum,
  MultipleRetrievalConfig,
} from './types'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringVariableType,
} from './types'
import {
  getMultipleRetrievalConfig,
  getSelectedDatasetsMode,
} from './utils'
import { RETRIEVE_TYPE } from '@/types/app'
import { DATASET_DEFAULT } from '@/config'
import type { DataSet } from '@/models/datasets'
import { fetchDatasets } from '@/service/datasets'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useCurrentProviderAndModel, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { useDatasetsDetailStore } from '../../datasets-detail-store/store'

const useConfig = (id: string, payload: KnowledgeRetrievalNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const startNode = getBeforeNodesInSameBranch(id).find(node => node.data.type === BlockEnum.Start)
  const startNodeId = startNode?.id
  const { inputs, setInputs: doSetInputs } = useNodeCrud<KnowledgeRetrievalNodeType>(id, payload)
  const updateDatasetsDetail = useDatasetsDetailStore(s => s.updateDatasetsDetail)

  const inputRef = useRef(inputs)

  const setInputs = useCallback((s: KnowledgeRetrievalNodeType) => {
    const newInputs = produce(s, (draft) => {
      if (s.retrieval_mode === RETRIEVE_TYPE.multiWay)
        delete draft.single_retrieval_config
      else
        delete draft.multiple_retrieval_config
    })
    // not work in pass to draft...
    doSetInputs(newInputs)
    inputRef.current = newInputs
  }, [doSetInputs])

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
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const {
    currentModel: currentRerankModel,
    currentProvider: currentRerankProvider,
  } = useCurrentProviderAndModel(
    rerankModelList,
    rerankDefaultModel
      ? {
        ...rerankDefaultModel,
        provider: rerankDefaultModel.provider.provider,
      }
      : undefined,
  )

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
    if (inputs.retrieval_mode === RETRIEVE_TYPE.multiWay && inputs.multiple_retrieval_config?.reranking_model?.provider && currentRerankModel && rerankDefaultModel)
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
        reranking_model: multipleRetrievalConfig?.reranking_model,
        reranking_mode: multipleRetrievalConfig?.reranking_mode,
        weights: multipleRetrievalConfig?.weights,
        reranking_enable: multipleRetrievalConfig?.reranking_enable !== undefined
          ? multipleRetrievalConfig.reranking_enable
          : Boolean(currentRerankModel && rerankDefaultModel),
      }
    })
    setInputs(newInput)
  }, [currentProvider?.provider, currentModel, currentRerankModel, rerankDefaultModel])
  const [selectedDatasets, setSelectedDatasets] = useState<DataSet[]>([])
  const [rerankModelOpen, setRerankModelOpen] = useState(false)
  const handleRetrievalModeChange = useCallback((newMode: RETRIEVE_TYPE) => {
    const newInputs = produce(inputs, (draft) => {
      draft.retrieval_mode = newMode
      if (newMode === RETRIEVE_TYPE.multiWay) {
        const multipleRetrievalConfig = draft.multiple_retrieval_config
        draft.multiple_retrieval_config = getMultipleRetrievalConfig(multipleRetrievalConfig!, selectedDatasets, selectedDatasets, {
          provider: currentRerankProvider?.provider,
          model: currentRerankModel?.model,
        })
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
  }, [currentModel?.model, currentModel?.model_properties?.mode, currentProvider?.provider, inputs, setInputs, selectedDatasets, currentRerankModel, currentRerankProvider])

  const handleMultipleRetrievalConfigChange = useCallback((newConfig: MultipleRetrievalConfig) => {
    const newInputs = produce(inputs, (draft) => {
      const newMultipleRetrievalConfig = getMultipleRetrievalConfig(newConfig!, selectedDatasets, selectedDatasets, {
        provider: currentRerankProvider?.provider,
        model: currentRerankModel?.model,
      })
      draft.multiple_retrieval_config = newMultipleRetrievalConfig
    })
    setInputs(newInputs)
  }, [inputs, setInputs, selectedDatasets, currentRerankModel, currentRerankProvider])

  const [selectedDatasetsLoaded, setSelectedDatasetsLoaded] = useState(false)
  // datasets
  useEffect(() => {
    (async () => {
      const inputs = inputRef.current
      const datasetIds = inputs.dataset_ids
      if (datasetIds?.length > 0) {
        const { data: dataSetsWithDetail } = await fetchDatasets({ url: '/datasets', params: { page: 1, ids: datasetIds } as any })
        setSelectedDatasets(dataSetsWithDetail)
      }
      const newInputs = produce(inputs, (draft) => {
        draft.dataset_ids = datasetIds
      })
      setInputs(newInputs)
      setSelectedDatasetsLoaded(true)
    })()
  }, [])

  useEffect(() => {
    const inputs = inputRef.current
    let query_variable_selector: ValueSelector = inputs.query_variable_selector
    if (isChatMode && inputs.query_variable_selector.length === 0 && startNodeId)
      query_variable_selector = [startNodeId, 'sys.query']

    setInputs(produce(inputs, (draft) => {
      draft.query_variable_selector = query_variable_selector
    }))
  }, [])

  const handleOnDatasetsChange = useCallback((newDatasets: DataSet[]) => {
    const {
      mixtureHighQualityAndEconomic,
      mixtureInternalAndExternal,
      inconsistentEmbeddingModel,
      allInternal,
      allExternal,
    } = getSelectedDatasetsMode(newDatasets)
    const newInputs = produce(inputs, (draft) => {
      draft.dataset_ids = newDatasets.map(d => d.id)

      if (payload.retrieval_mode === RETRIEVE_TYPE.multiWay && newDatasets.length > 0) {
        const multipleRetrievalConfig = draft.multiple_retrieval_config
        const newMultipleRetrievalConfig = getMultipleRetrievalConfig(multipleRetrievalConfig!, newDatasets, selectedDatasets, {
          provider: currentRerankProvider?.provider,
          model: currentRerankModel?.model,
        })
        draft.multiple_retrieval_config = newMultipleRetrievalConfig
      }
    })
    updateDatasetsDetail(newDatasets)
    setInputs(newInputs)
    setSelectedDatasets(newDatasets)

    if (
      (allInternal && (mixtureHighQualityAndEconomic || inconsistentEmbeddingModel))
      || mixtureInternalAndExternal
      || allExternal
    )
      setRerankModelOpen(true)
  }, [inputs, setInputs, payload.retrieval_mode, selectedDatasets, currentRerankModel, currentRerankProvider, updateDatasetsDetail])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.string
  }, [])

  const handleMetadataFilterModeChange = useCallback((newMode: MetadataFilteringModeEnum) => {
    setInputs(produce(inputRef.current, (draft) => {
      draft.metadata_filtering_mode = newMode
    }))
  }, [setInputs])

  const handleAddCondition = useCallback<HandleAddCondition>(({ name, type }) => {
    let operator: ComparisonOperator = ComparisonOperator.is

    if (type === MetadataFilteringVariableType.number)
      operator = ComparisonOperator.equal

    const newCondition = {
      id: uuid4(),
      name,
      comparison_operator: operator,
    }

    const newInputs = produce(inputRef.current, (draft) => {
      if (draft.metadata_filtering_conditions) {
        draft.metadata_filtering_conditions.conditions.push(newCondition)
      }
      else {
        draft.metadata_filtering_conditions = {
          logical_operator: LogicalOperator.and,
          conditions: [newCondition],
        }
      }
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((id) => {
    const conditions = inputRef.current.metadata_filtering_conditions?.conditions || []
    const index = conditions.findIndex(c => c.id === id)
    const newInputs = produce(inputRef.current, (draft) => {
      if (index > -1)
        draft.metadata_filtering_conditions?.conditions.splice(index, 1)
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((id, newCondition) => {
    const conditions = inputRef.current.metadata_filtering_conditions?.conditions || []
    const index = conditions.findIndex(c => c.id === id)
    const newInputs = produce(inputRef.current, (draft) => {
      if (index > -1)
        draft.metadata_filtering_conditions!.conditions[index] = newCondition
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleToggleConditionLogicalOperator = useCallback<HandleToggleConditionLogicalOperator>(() => {
    const oldLogicalOperator = inputRef.current.metadata_filtering_conditions?.logical_operator
    const newLogicalOperator = oldLogicalOperator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
    const newInputs = produce(inputRef.current, (draft) => {
      draft.metadata_filtering_conditions!.logical_operator = newLogicalOperator
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleMetadataModelChange = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.metadata_model_config = {
        provider: model.provider,
        name: model.modelId,
        mode: model.mode || 'chat',
        completion_params: draft.metadata_model_config?.completion_params || { temperature: 0.7 },
      }
    })
    setInputs(newInputs)
  }, [setInputs])

  const handleMetadataCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.metadata_model_config = {
        ...draft.metadata_model_config!,
        completion_params: newParams,
      }
    })
    setInputs(newInputs)
  }, [setInputs])

  const filterStringVar = useCallback((varPayload: Var) => {
    return [VarType.string].includes(varPayload.type)
  }, [])

  const {
    availableVars: availableStringVars,
    availableNodesWithParent: availableStringNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterStringVar,
  })

  const filterNumberVar = useCallback((varPayload: Var) => {
    return [VarType.number].includes(varPayload.type)
  }, [])

  const {
    availableVars: availableNumberVars,
    availableNodesWithParent: availableNumberNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterNumberVar,
  })

  return {
    readOnly,
    inputs,
    handleQueryVarChange,
    filterVar,
    handleRetrievalModeChange,
    handleMultipleRetrievalConfigChange,
    handleModelChanged,
    handleCompletionParamsChange,
    selectedDatasets: selectedDatasets.filter(d => d.name),
    selectedDatasetsLoaded,
    handleOnDatasetsChange,
    rerankModelOpen,
    setRerankModelOpen,
    handleMetadataFilterModeChange,
    handleUpdateCondition,
    handleAddCondition,
    handleRemoveCondition,
    handleToggleConditionLogicalOperator,
    handleMetadataModelChange,
    handleMetadataCompletionParamsChange,
    availableStringVars,
    availableStringNodesWithParent,
    availableNumberVars,
    availableNumberNodesWithParent,
  }
}

export default useConfig
