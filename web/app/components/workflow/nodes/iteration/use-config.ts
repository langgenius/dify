import { useCallback } from 'react'
import produce from 'immer'
import {
  useIsChatMode,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import { VarType } from '../../types'
import type { ValueSelector, Var } from '../../types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { getNodeInfoById, getNodeUsedVars, isSystemVar, toNodeOutputVars } from '../_base/components/variable/utils'
import useOneStepRun from '../_base/hooks/use-one-step-run'
import type { IterationNodeType } from './types'

const useConfig = (id: string, payload: IterationNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const isChatMode = useIsChatMode()

  const { inputs, setInputs } = useNodeCrud<IterationNodeType>(id, payload)

  const filterInputVar = useCallback((varPayload: Var) => {
    return [VarType.array, VarType.arrayString, VarType.arrayNumber, VarType.arrayObject].includes(varPayload.type)
  }, [])

  const handleInputChange = useCallback((input: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.iterator_selector = input as ValueSelector || []
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // output
  const { getIterationNodeChildren, getBeforeNodesInSameBranch } = useWorkflow()
  const beforeNodes = getBeforeNodesInSameBranch(id)
  const iterationChildrenNodes = getIterationNodeChildren(id)
  const childrenNodeVars = toNodeOutputVars(iterationChildrenNodes, isChatMode)

  const handleOutputVarChange = useCallback((output: ValueSelector | string) => {
    const newInputs = produce(inputs, (draft) => {
      draft.output_selector = output as ValueSelector || []
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // single run
  const {
    isShowSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    handleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
  } = useOneStepRun<IterationNodeType>({
    id,
    data: inputs,
    defaultRunInputData: {
      '#iterator#': [''],
    },
  })

  const usedOutVars = (() => {
    const vars: ValueSelector[] = []
    const varObjs: Record<string, boolean> = {}
    iterationChildrenNodes.forEach((node) => {
      const nodeVars = getNodeUsedVars(node).filter(item => item && item.length > 0)
      nodeVars.forEach((varSelector) => {
        if (!varObjs[varSelector.join('.')]) {
          varObjs[varSelector.join('.')] = true
          vars.push(varSelector)
        }
      })
    })
    const res = toVarInputs(vars.map((item) => {
      const varInfo = getNodeInfoById(beforeNodes, item[0])
      return {
        label: {
          nodeType: varInfo?.type,
          nodeName: varInfo?.title || beforeNodes[0]?.data.title, // default start node title
          variable: isSystemVar(item) ? item.join('.') : item[item.length - 1],
        },
        variable: `#${item.join('.')}#`,
        value_selector: item,
      }
    }))
    return res
  })()

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .filter(key => !['#iterator#'].includes(key))
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    const newVars = {
      ...newPayload,
      '#iterator#': runInputData['#iterator#'],
    }
    setRunInputData(newVars)
  }, [runInputData, setRunInputData])

  const iterator = runInputData['#iterator#']
  const setIterator = useCallback((newIterator: string[]) => {
    setRunInputData({
      ...runInputData,
      '#iterator#': newIterator,
    })
  }, [runInputData, setRunInputData])

  return {
    readOnly,
    inputs,
    filterInputVar,
    handleInputChange,
    childrenNodeVars,
    iterationChildrenNodes,
    handleOutputVarChange,
    isShowSingleRun,
    hideSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    inputVarValues,
    setInputVarValues,
    usedOutVars,
    iterator,
    setIterator,
  }
}

export default useConfig
