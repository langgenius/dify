import type { RefObject } from 'react'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import type { IterationNodeType } from './types'
import { useTranslation } from 'react-i18next'
import { useIsNodeInIteration, useWorkflow } from '../../hooks'
import { getNodeInfoById, getNodeUsedVarPassToServerKey, getNodeUsedVars, isSystemVar } from '../_base/components/variable/utils'
import { InputVarType, VarType } from '@/app/components/workflow/types'
import formatTracing from '@/app/components/workflow/run/utils/format-log'
import type { NodeTracing } from '@/types/workflow'
import { VALUE_SELECTOR_DELIMITER as DELIMITER } from '@/config'

const i18nPrefix = 'workflow.nodes.iteration'

type Params = {
  id: string,
  payload: IterationNodeType,
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  iterationRunResult: NodeTracing[]
}
const useSingleRunFormParams = ({
  id,
  payload,
  runInputData,
  toVarInputs,
  setRunInputData,
  iterationRunResult,
}: Params) => {
  const { t } = useTranslation()
  const { isNodeInIteration } = useIsNodeInIteration(id)

  const { getIterationNodeChildren, getBeforeNodesInSameBranch } = useWorkflow()
  const iterationChildrenNodes = getIterationNodeChildren(id)
  const beforeNodes = getBeforeNodesInSameBranch(id)
  const canChooseVarNodes = [...beforeNodes, ...iterationChildrenNodes]

  const iteratorInputKey = `${id}.input_selector`
  const iterator = runInputData[iteratorInputKey]
  const setIterator = useCallback((newIterator: string[]) => {
    setRunInputData({
      ...runInputData,
      [iteratorInputKey]: newIterator,
    })
  }, [iteratorInputKey, runInputData, setRunInputData])

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

  const forms = useMemo(() => {
    return [
      {
        inputs: [...usedOutVars],
        values: inputVarValues,
        onChange: setInputVarValues,
      },
      {
        label: t(`${i18nPrefix}.input`)!,
        inputs: [{
          label: '',
          variable: iteratorInputKey,
          type: InputVarType.iterator,
          required: false,
          getVarValueFromDependent: true,
          isFileItem: payload.iterator_input_type === VarType.arrayFile,
        }],
        values: { [iteratorInputKey]: iterator },
        onChange: (keyValue: Record<string, any>) => setIterator(keyValue[iteratorInputKey]),
      },
    ]
  }, [inputVarValues, iterator, iteratorInputKey, payload.iterator_input_type, setInputVarValues, setIterator, t, usedOutVars])

  const nodeInfo = formatTracing(iterationRunResult, t)[0]

  const getDependentVars = () => {
    return [payload.iterator_selector]
  }
  const getDependentVar = (variable: string) => {
    if(variable === iteratorInputKey)
      return payload.iterator_selector
  }

  return {
    forms,
    nodeInfo,
    allVarObject,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
