import { useCallback } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import {
  useIsChatMode,
  useIsNodeInIteration,
  useNodesReadOnly,
  useWorkflow,
} from '../../hooks'
import { VarType } from '../../types'
import type { ValueSelector, Var } from '../../types'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { getNodeInfoById, getNodeUsedVarPassToServerKey, getNodeUsedVars, isSystemVar, toNodeOutputVars } from '../_base/components/variable/utils'
import useOneStepRun from '../_base/hooks/use-one-step-run'
import type { IterationNodeType } from './types'
import type { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

const DELIMITER = '@@@@@'
const useConfig = (id: string, payload: IterationNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { isNodeInIteration } = useIsNodeInIteration(id)
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
  const canChooseVarNodes = [...beforeNodes, ...iterationChildrenNodes]
  const childrenNodeVars = toNodeOutputVars(iterationChildrenNodes, isChatMode)

  const handleOutputVarChange = useCallback((output: ValueSelector | string, _varKindType: VarKindType, varInfo?: Var) => {
    const newInputs = produce(inputs, (draft) => {
      draft.output_selector = output as ValueSelector || []
      const outputItemType = varInfo?.type || VarType.string

      draft.output_type = ({
        [VarType.string]: VarType.arrayString,
        [VarType.number]: VarType.arrayNumber,
        [VarType.object]: VarType.arrayObject,
      } as Record<VarType, VarType>)[outputItemType] || VarType.arrayString
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  // single run
  const iteratorInputKey = `${id}.input_selector`
  const {
    isShowSingleRun,
    showSingleRun,
    hideSingleRun,
    toVarInputs,
    runningStatus,
    handleRun: doHandleRun,
    handleStop,
    runInputData,
    setRunInputData,
    runResult,
    iterationRunResult,
  } = useOneStepRun<IterationNodeType>({
    id,
    data: inputs,
    iteratorInputKey,
    defaultRunInputData: {
      [iteratorInputKey]: [''],
    },
  })

  const [isShowIterationDetail, {
    setTrue: doShowIterationDetail,
    setFalse: doHideIterationDetail,
  }] = useBoolean(false)

  const hideIterationDetail = useCallback(() => {
    hideSingleRun()
    doHideIterationDetail()
  }, [doHideIterationDetail, hideSingleRun])

  const showIterationDetail = useCallback(() => {
    doShowIterationDetail()
  }, [doShowIterationDetail])

  const backToSingleRun = useCallback(() => {
    hideIterationDetail()
    showSingleRun()
  }, [hideIterationDetail, showSingleRun])

  const { usedOutVars, allVarObject } = (() => {
    const vars: ValueSelector[] = []
    const varObjs: Record<string, boolean> = {}
    const allVarObject: Record<string, {
      inSingleRunPassedKey: string
    }> = {}
    iterationChildrenNodes.forEach((node) => {
      const nodeVars = getNodeUsedVars(node).filter(item => item && item.length > 0)
      nodeVars.forEach((varSelector) => {
        if (varSelector[0] === id) { // skip iteration node itself variable: item, index
          return
        }
        const isInIteration = isNodeInIteration(varSelector[0])
        if (isInIteration) // not pass iteration inner variable
          return

        const varSectorStr = varSelector.join('.')
        if (!varObjs[varSectorStr]) {
          varObjs[varSectorStr] = true
          vars.push(varSelector)
        }
        let passToServerKeys = getNodeUsedVarPassToServerKey(node, varSelector)
        if (typeof passToServerKeys === 'string')
          passToServerKeys = [passToServerKeys]

        passToServerKeys.forEach((key: string, index: number) => {
          allVarObject[[varSectorStr, node.id, index].join(DELIMITER)] = {
            inSingleRunPassedKey: key,
          }
        })
      })
    })
    const res = toVarInputs(vars.map((item) => {
      const varInfo = getNodeInfoById(canChooseVarNodes, item[0])
      return {
        label: {
          nodeType: varInfo?.data.type,
          nodeName: varInfo?.data.title || canChooseVarNodes[0]?.data.title, // default start node title
          variable: isSystemVar(item) ? item.join('.') : item[item.length - 1],
        },
        variable: `${item.join('.')}`,
        value_selector: item,
      }
    }))
    return {
      usedOutVars: res,
      allVarObject,
    }
  })()

  const handleRun = useCallback((data: Record<string, any>) => {
    const formattedData: Record<string, any> = {}
    Object.keys(allVarObject).forEach((key) => {
      const [varSectorStr, nodeId] = key.split(DELIMITER)
      formattedData[`${nodeId}.${allVarObject[key].inSingleRunPassedKey}`] = data[varSectorStr]
    })
    formattedData[iteratorInputKey] = data[iteratorInputKey]
    doHandleRun(formattedData)
  }, [allVarObject, doHandleRun, iteratorInputKey])

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .filter(key => ![iteratorInputKey].includes(key))
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    const newVars = {
      ...newPayload,
      [iteratorInputKey]: runInputData[iteratorInputKey],
    }
    setRunInputData(newVars)
  }, [iteratorInputKey, runInputData, setRunInputData])

  const iterator = runInputData[iteratorInputKey]
  const setIterator = useCallback((newIterator: string[]) => {
    setRunInputData({
      ...runInputData,
      [iteratorInputKey]: newIterator,
    })
  }, [iteratorInputKey, runInputData, setRunInputData])

  return {
    readOnly,
    inputs,
    filterInputVar,
    handleInputChange,
    childrenNodeVars,
    iterationChildrenNodes,
    handleOutputVarChange,
    isShowSingleRun,
    showSingleRun,
    hideSingleRun,
    isShowIterationDetail,
    showIterationDetail,
    hideIterationDetail,
    backToSingleRun,
    runningStatus,
    handleRun,
    handleStop,
    runResult,
    inputVarValues,
    setInputVarValues,
    usedOutVars,
    iterator,
    setIterator,
    iteratorInputKey,
    iterationRunResult,
  }
}

export default useConfig
