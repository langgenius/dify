import { useCallback, useEffect, useRef, useState } from 'react'
import { produce } from 'immer'
import { BlockEnum, VarType } from '../../types'
import type { Memory, ValueSelector, Var } from '../../types'
import {
  useIsChatMode, useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import { useStore } from '../../store'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useConfigVision from '../../hooks/use-config-vision'
import type { QuestionClassifierNodeType, Topic } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'
import { useUpdateNodeInternals } from 'reactflow'

const useConfig = (id: string, payload: QuestionClassifierNodeType) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const defaultConfig = useStore(s => s.nodesDefaultConfigs)?.[payload.type]
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const startNode = getBeforeNodesInSameBranch(id).find(node => node.data.type === BlockEnum.Start)
  const startNodeId = startNode?.id
  const { inputs, setInputs } = useNodeCrud<QuestionClassifierNodeType>(id, payload)
  const inputRef = useRef(inputs)
  useEffect(() => {
    inputRef.current = inputs
  }, [inputs])

  const [modelChanged, setModelChanged] = useState(false)
  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  const model = inputs.model
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === 'chat'

  const {
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    handleModelChanged: handleVisionConfigAfterModelChanged,
  } = useConfigVision(model, {
    payload: inputs.vision,
    onChange: (newPayload) => {
      const newInputs = produce(inputs, (draft) => {
        draft.vision = newPayload
      })
      setInputs(newInputs)
    },
  })

  const handleModelChanged = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
    })
    setInputs(newInputs)
    setModelChanged(true)
  }, [setInputs])

  useEffect(() => {
    if (currentProvider?.provider && currentModel?.model && !model.provider) {
      handleModelChanged({
        provider: currentProvider?.provider,
        modelId: currentModel?.model,
        mode: currentModel?.model_properties?.mode as string,
      })
    }
  }, [model.provider, currentProvider, currentModel, handleModelChanged])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // change to vision model to set vision enabled, else disabled
  useEffect(() => {
    if (!modelChanged)
      return
    setModelChanged(false)
    handleVisionConfigAfterModelChanged()
  }, [isVisionModel, modelChanged])

  const handleQueryVarChange = useCallback((newVar: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query_variable_selector = newVar as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  useEffect(() => {
    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (isReady) {
      let query_variable_selector: ValueSelector = []
      if (isChatMode && inputs.query_variable_selector.length === 0 && startNodeId)
        query_variable_selector = [startNodeId, 'sys.query']
      setInputs({
        ...inputs,
        ...defaultConfig,
        query_variable_selector: inputs.query_variable_selector.length > 0 ? inputs.query_variable_selector : query_variable_selector,
      })
    }
  }, [defaultConfig])

  const handleClassesChange = useCallback((newClasses: any) => {
    const newInputs = produce(inputs, (draft) => {
      draft.classes = newClasses
      draft._targetBranches = newClasses
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.number, VarType.string].includes(varPayload.type)
  }, [])

  const filterVisionInputVar = useCallback((varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }, [])

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterInputVar,
  })

  const {
    availableVars: availableVisionVars,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterVisionInputVar,
  })

  const hasSetBlockStatus = {
    history: false,
    query: isChatMode ? checkHasQueryBlock(inputs.instruction) : false,
    context: false,
  }

  const handleInstructionChange = useCallback((instruction: string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.instruction = instruction
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleMemoryChange = useCallback((memory?: Memory) => {
    const newInputs = produce(inputs, (draft) => {
      draft.memory = memory
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.string
  }, [])

  const handleSortTopic = useCallback((newTopics: (Topic & { id: string })[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.classes = newTopics.filter(Boolean).map(item => ({
        id: item.id,
        name: item.name,
      }))
    })
    setInputs(newInputs)
    updateNodeInternals(id)
  }, [id, inputs, setInputs, updateNodeInternals])

  return {
    readOnly,
    inputs,
    handleModelChanged,
    isChatMode,
    isChatModel,
    handleCompletionParamsChange,
    handleQueryVarChange,
    filterVar,
    handleTopicsChange: handleClassesChange,
    hasSetBlockStatus,
    availableVars,
    availableNodesWithParent,
    availableVisionVars,
    handleInstructionChange,
    handleMemoryChange,
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    handleSortTopic,
  }
}

export default useConfig
