import type { Memory, ValueSelector, Var } from '../../types'
import type { QuestionClassifierNodeType, Topic } from './types'
import { produce } from 'immer'
import { startTransition, useCallback, useEffect, useRef } from 'react'
import { useUpdateNodeInternals } from 'reactflow'
import { checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { AppModeEnum } from '@/types/app'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import useConfigVision from '../../hooks/use-config-vision'
import { useStore } from '../../store'
import { BlockEnum, VarType } from '../../types'
import useAvailableVarList from '../_base/hooks/use-available-var-list'

const useConfig = (id: string, payload: QuestionClassifierNodeType) => {
  const updateNodeInternals = useUpdateNodeInternals()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const defaultConfig = useStore(s => s.nodesDefaultConfigs)?.[payload.type]
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const startNode = getBeforeNodesInSameBranch(id).find(node => node.data.type === BlockEnum.Start)
  const startNodeId = startNode?.id
  const { inputs, setInputs: doSetInputs } = useNodeCrud<QuestionClassifierNodeType>(id, payload)
  const inputRef = useRef(inputs)
  const setInputs = useCallback((newInputs: QuestionClassifierNodeType) => {
    doSetInputs(newInputs)
    inputRef.current = newInputs
  }, [doSetInputs])
  useEffect(() => {
    inputRef.current = inputs
  }, [inputs])

  const isHandlingModelChangeRef = useRef(false)
  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)

  const model = inputs.model
  const modelMode = inputs.model?.mode
  const isChatModel = modelMode === AppModeEnum.CHAT

  const handleVisionChange = useCallback((newPayload: QuestionClassifierNodeType['vision']) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.vision = newPayload
    })
    setInputs(newInputs)
  }, [setInputs])

  const {
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
    handleModelChanged: handleVisionConfigAfterModelChanged,
  } = useConfigVision(model, {
    payload: inputs.vision,
    onChange: handleVisionChange,
  })

  const handleModelChanged = useCallback((model: { provider: string, modelId: string, mode?: string }) => {
    const newInputs = produce(inputRef.current, (draft) => {
      draft.model.provider = model.provider
      draft.model.name = model.modelId
      draft.model.mode = model.mode!
    })
    isHandlingModelChangeRef.current = true
    setInputs(newInputs)
  }, [setInputs])

  useEffect(() => {
    if (currentProvider?.provider && currentModel?.model && !model.provider) {
      startTransition(() => {
        handleModelChanged({
          provider: currentProvider?.provider,
          modelId: currentModel?.model,
          mode: currentModel?.model_properties?.mode as string | undefined,
        })
      })
    }
  }, [model.provider, currentProvider, currentModel, handleModelChanged])

  const handleCompletionParamsChange = useCallback((newParams: Record<string, unknown>) => {
    const newInputs = produce(inputs, (draft) => {
      draft.model.completion_params = newParams
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // change to vision model to set vision enabled, else disabled
  useEffect(() => {
    if (!isHandlingModelChangeRef.current)
      return
    isHandlingModelChangeRef.current = false
    startTransition(() => {
      handleVisionConfigAfterModelChanged()
    })
  }, [handleVisionConfigAfterModelChanged, isVisionModel])

  const handleQueryVarChange = useCallback((newVar: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.query_variable_selector = newVar as ValueSelector
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  useEffect(() => {
    const isReady = defaultConfig && Object.keys(defaultConfig).length > 0
    if (!isReady)
      return

    const currentInputs = inputRef.current
    let shouldUpdate = false

    const nextInputs = produce(currentInputs, (draft) => {
      if (!draft.model)
        draft.model = defaultConfig.model

      if (!draft.classes)
        draft.classes = defaultConfig.classes

      if (!draft._targetBranches)
        draft._targetBranches = defaultConfig._targetBranches

      if (!draft.vision)
        draft.vision = defaultConfig.vision

      if (draft.query_variable_selector.length === 0 && isChatMode && startNodeId) {
        draft.query_variable_selector = [startNodeId, 'sys.query']
        shouldUpdate = true
      }

      if (!currentInputs.model && defaultConfig.model)
        shouldUpdate = true

      if (!currentInputs.classes && defaultConfig.classes)
        shouldUpdate = true

      if (!currentInputs._targetBranches && defaultConfig._targetBranches)
        shouldUpdate = true

      if (!currentInputs.vision && defaultConfig.vision)
        shouldUpdate = true
    })

    if (!shouldUpdate)
      return

    startTransition(() => {
      setInputs(nextInputs)
    })
  }, [defaultConfig, isChatMode, setInputs, startNodeId])

  const handleClassesChange = useCallback((newClasses: Topic[]) => {
    const newInputs = produce(inputs, (draft) => {
      draft.classes = newClasses
      draft._targetBranches = newClasses.map((item: Topic) => ({
        id: item.id,
        name: item.name,
      }))
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
      const sortedTopics = newTopics.filter(Boolean)
      draft.classes = sortedTopics.map(item => ({
        id: item.id,
        name: item.name,
        label: item.label,
      }))
      draft._targetBranches = sortedTopics.map(item => ({
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
