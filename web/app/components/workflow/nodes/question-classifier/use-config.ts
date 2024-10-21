import { useCallback, useEffect, useRef, useState } from 'react'
import produce from 'immer'
import { BlockEnum, VarType } from '../../types'
import type { Memory, ValueSelector, Var } from '../../types'
import {
  useIsChatMode, useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import { useStore } from '../../store'
import useAvailableVarList from '../_base/hooks/use-available-var-list'
import useConfigVision from '../../hooks/use-config-vision'
import type { QuestionClassifierNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { checkHasQueryBlock } from '@/app/components/base/prompt-editor/constants'

const useConfig = (id: string, payload: QuestionClassifierNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()
  const defaultConfig = useStore(s => s.nodesDefaultConfigs)[payload.type]
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const {
    availableVars,
    availableNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterInputVar,
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

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    getInputVars,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<QuestionClassifierNodeType>({
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

  const varInputs = getInputVars([inputs.instruction])
  const inputVarValues = (() => {
    const vars: Record<string, any> = {
      query,
    }
    Object.keys(runInputData)
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    setRunInputData(newPayload)
  }, [setRunInputData])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.string
  }, [])

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
    handleInstructionChange,
    varInputs,
    inputVarValues,
    setInputVarValues,
    handleMemoryChange,
    isVisionModel,
    handleVisionResolutionEnabledChange,
    handleVisionResolutionChange,
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
