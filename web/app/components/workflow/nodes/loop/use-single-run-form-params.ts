import type { NodeTracing } from '@/types/workflow'
import { useCallback, useMemo } from 'react'
import formatTracing from '@/app/components/workflow/run/utils/format-log'
import { useTranslation } from 'react-i18next'
import { useIsNodeInLoop, useWorkflow } from '../../hooks'
import { getNodeInfoById, getNodeUsedVarPassToServerKey, getNodeUsedVars, isSystemVar } from '../_base/components/variable/utils'
import type { InputVar, ValueSelector, Variable } from '../../types'
import type { CaseItem, Condition, LoopNodeType } from './types'
import { ValueType } from '@/app/components/workflow/types'
import { VALUE_SELECTOR_DELIMITER as DELIMITER } from '@/config'

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
  const canChooseVarNodes = [...beforeNodes, ...loopChildrenNodes]

  const { usedOutVars, allVarObject } = (() => {
    const vars: ValueSelector[] = []
    const varObjs: Record<string, boolean> = {}
    const allVarObject: Record<string, {
      inSingleRunPassedKey: string
    }> = {}
    loopChildrenNodes.forEach((node) => {
      const nodeVars = getNodeUsedVars(node).filter(item => item && item.length > 0)
      nodeVars.forEach((varSelector) => {
        if (varSelector[0] === id) { // skip loop node itself variable: item, index
          return
        }
        const isInLoop = isNodeInLoop(varSelector[0])
        if (isInLoop) // not pass loop inner variable
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

  const inputVarValues = (() => {
    const vars: Record<string, any> = {}
    Object.keys(runInputData)
      .forEach((key) => {
        vars[key] = runInputData[key]
      })
    return vars
  })()

  const getVarSelectorsFromCase = (caseItem: CaseItem): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (caseItem.conditions && caseItem.conditions.length) {
      caseItem.conditions.forEach((condition) => {
        // eslint-disable-next-line ts/no-use-before-define
        const conditionVars = getVarSelectorsFromCondition(condition)
        vars.push(...conditionVars)
      })
    }
    return vars
  }

  const getVarSelectorsFromCondition = (condition: Condition) => {
    const vars: ValueSelector[] = []
    if (condition.variable_selector)
      vars.push(condition.variable_selector)

    if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
      vars.push(...getVarSelectorsFromCase(condition.sub_variable_condition))
    return vars
  }

  const forms = (() => {
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
    const existVarsKey: Record<string, boolean> = {}
    const uniqueVarInputs: InputVar[] = []
    varInputs.forEach((input) => {
      if (!input)
        return
      if (!existVarsKey[input.variable]) {
        existVarsKey[input.variable] = true
        uniqueVarInputs.push(input)
      }
    })
    return [
      {
        inputs: [...usedOutVars, ...uniqueVarInputs],
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    ]
  })()

  const getVarFromCaseItem = (caseItem: CaseItem): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (caseItem.conditions && caseItem.conditions.length) {
      caseItem.conditions.forEach((condition) => {
        // eslint-disable-next-line ts/no-use-before-define
        const conditionVars = getVarFromCondition(condition)
        vars.push(...conditionVars)
      })
    }
    return vars
  }

  const getVarFromCondition = (condition: Condition): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (condition.variable_selector)
      vars.push(condition.variable_selector)

    if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
      vars.push(...getVarFromCaseItem(condition.sub_variable_condition))
    return vars
  }

  const getDependentVars = () => {
    const vars: ValueSelector[] = usedOutVars.map(item => item.variable.split('.'))
    payload.break_conditions?.forEach((condition) => {
      const conditionVars = getVarFromCondition(condition)
      vars.push(...conditionVars)
    })
    payload.loop_variables?.forEach((loopVariable) => {
      if (loopVariable.value_type === ValueType.variable)
        vars.push(loopVariable.value)
    })
    const hasFilterLoopVars = vars.filter(item => item[0] !== id)
    return hasFilterLoopVars
  }

  return {
    forms,
    nodeInfo,
    allVarObject,
    getDependentVars,
  }
}

export default useSingleRunFormParams
