import type { InputVar, ValueSelector, Variable } from '../../types'
import type { LoopNodeType } from './types'
import type { NodeTracing } from '@/types/workflow'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import formatTracing from '@/app/components/workflow/run/utils/format-log'
import { ValueType } from '@/app/components/workflow/types'
import { useIsNodeInLoop, useWorkflow } from '../../hooks'
import {
  buildUsedOutVars,
  createInputVarValues,
  dedupeInputVars,
  getDependentVarsFromLoopPayload,
  getVarSelectorsFromCondition,
} from './use-single-run-form-params.helpers'

type Params = {
  id: string
  payload: LoopNodeType
  runInputData: Record<string, any>
  runResult: NodeTracing
  loopRunResult: NodeTracing[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  varSelectorsToVarInputs: (variables: ValueSelector[]) => InputVar[]
}

const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  runResult,
  loopRunResult,
  setRunInputData,
  toVarInputs,
  varSelectorsToVarInputs,
}: Params) => {
  const { t } = useTranslation()

  const { isNodeInLoop } = useIsNodeInLoop(id)

  const { getLoopNodeChildren, getBeforeNodesInSameBranch } = useWorkflow()
  const loopChildrenNodes = getLoopNodeChildren(id)
  const beforeNodes = getBeforeNodesInSameBranch(id)
  const canChooseVarNodes = useMemo(() => [...beforeNodes, ...loopChildrenNodes], [beforeNodes, loopChildrenNodes])

  const { usedOutVars, allVarObject } = useMemo(() => buildUsedOutVars({
    loopChildrenNodes,
    currentNodeId: id,
    canChooseVarNodes,
    isNodeInLoop,
    toVarInputs,
  }), [loopChildrenNodes, id, canChooseVarNodes, isNodeInLoop, toVarInputs])

  const nodeInfo = useMemo(() => {
    const formattedNodeInfo = formatTracing(loopRunResult, t)[0]

    if (runResult && formattedNodeInfo) {
      return {
        ...formattedNodeInfo,
        execution_metadata: {
          ...runResult.execution_metadata,
          ...formattedNodeInfo.execution_metadata,
        },
      }
    }

    return formattedNodeInfo
  }, [runResult, loopRunResult, t])

  const setInputVarValues = useCallback((newPayload: Record<string, any>) => {
    setRunInputData(newPayload)
  }, [setRunInputData])

  const inputVarValues = useMemo(() => createInputVarValues(runInputData), [runInputData])

  const forms = useMemo(() => {
    const allInputs: ValueSelector[] = []
    payload.break_conditions?.forEach((condition) => {
      const vars = getVarSelectorsFromCondition(condition)
      allInputs.push(...vars)
    })

    payload.loop_variables?.forEach((loopVariable) => {
      if (loopVariable.value_type === ValueType.variable)
        allInputs.push(loopVariable.value)
    })
    const inputVarsFromValue: InputVar[] = []
    const varInputs = [...varSelectorsToVarInputs(allInputs), ...inputVarsFromValue]
    const uniqueVarInputs = dedupeInputVars(varInputs)
    return [
      {
        inputs: [...usedOutVars, ...uniqueVarInputs],
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    ]
  }, [payload.break_conditions, payload.loop_variables, varSelectorsToVarInputs, usedOutVars, inputVarValues, setInputVarValues])

  const getDependentVars = useCallback(() => getDependentVarsFromLoopPayload({
    nodeId: id,
    usedOutVars,
    breakConditions: payload.break_conditions,
    loopVariables: payload.loop_variables,
  }), [id, usedOutVars, payload.break_conditions, payload.loop_variables])

  return {
    forms,
    nodeInfo,
    allVarObject,
    getDependentVars,
  }
}

export default useSingleRunFormParams
