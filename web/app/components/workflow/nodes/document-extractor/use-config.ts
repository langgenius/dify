import { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'

import type { ValueSelector, Var } from '../../types'
import { InputVarType, VarType } from '../../types'
import { type DocExtractorNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useOneStepRun from '@/app/components/workflow/nodes/_base/hooks/use-one-step-run'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: DocExtractorNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<DocExtractorNodeType>(id, payload)

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === VarType.file || varPayload.type === VarType.arrayFile
  }, [])

  const isChatMode = useIsChatMode()

  const store = useStoreApi()
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const {
    getNodes,
  } = store.getState()
  const currentNode = getNodes().find(n => n.id === id)
  const isInIteration = payload.isInIteration
  const iterationNode = isInIteration ? getNodes().find(n => n.id === currentNode!.parentId) : null
  const availableNodes = useMemo(() => {
    return getBeforeNodesInSameBranch(id)
  }, [getBeforeNodesInSameBranch, id])

  const { getCurrentVariableType } = useWorkflowVariables()
  const getType = useCallback((variable?: ValueSelector) => {
    const varType = getCurrentVariableType({
      parentNode: iterationNode,
      valueSelector: variable || [],
      availableNodes,
      isChatMode,
      isConstant: false,
    })
    return varType
  }, [getCurrentVariableType, availableNodes, isChatMode, iterationNode])

  const handleVarChanges = useCallback((variable: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.variable_selector = variable as ValueSelector
      draft.is_array_file = getType(draft.variable_selector) === VarType.arrayFile
    })
    setInputs(newInputs)
  }, [getType, inputs, setInputs])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    isCompleted,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<DocExtractorNodeType>({
    id,
    data: inputs,
    defaultRunInputData: { files: [] },
  })
  const varInputs = [{
    label: inputs.title,
    variable: 'files',
    type: InputVarType.multiFiles,
    required: true,
  }]

  const files = runInputData.files
  const setFiles = useCallback((newFiles: []) => {
    setRunInputData({
      ...runInputData,
      files: newFiles,
    })
  }, [runInputData, setRunInputData])

  return {
    readOnly,
    inputs,
    filterVar,
    handleVarChanges,
    // single run
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    isCompleted,
    handleRun,
    handleStop,
    varInputs,
    files,
    setFiles,
    runResult,
  }
}

export default useConfig
