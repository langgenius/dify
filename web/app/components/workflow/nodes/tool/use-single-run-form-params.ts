import type { MutableRefObject } from 'react'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import { useCallback, useMemo, useState } from 'react'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { type ToolNodeType, VarType } from './types'
import type { ValueSelector } from '@/app/components/workflow/types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import produce from 'immer'
import type { NodeTracing } from '@/types/workflow'
import { useTranslation } from 'react-i18next'
import formatToTracingNodeList from '@/app/components/workflow/run/utils/format-log'
import { useToolIcon } from '../../hooks'

type Params = {
  id: string,
  payload: ToolNodeType,
  runInputData: Record<string, any>
  runInputDataRef: MutableRefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  runResult: NodeTracing
}
const useSingleRunFormParams = ({
  id,
  payload,
  getInputVars,
  setRunInputData,
  runResult,
}: Params) => {
  const { t } = useTranslation()
  const { inputs } = useNodeCrud<ToolNodeType>(id, payload)

  const hadVarParams = Object.keys(inputs.tool_parameters)
    .filter(key => inputs.tool_parameters[key].type !== VarType.constant)
    .map(k => inputs.tool_parameters[k])

  const hadVarSettings = Object.keys(inputs.tool_configurations)
    .filter(key => typeof inputs.tool_configurations[key] === 'object' && inputs.tool_configurations[key].type && inputs.tool_configurations[key].type !== VarType.constant)
    .map(k => inputs.tool_configurations[k])

  const varInputs = getInputVars([...hadVarParams, ...hadVarSettings].map((p) => {
    if (p.type === VarType.variable) {
      // handle the old wrong value not crash the page
      if (!(p.value as any).join)
        return `{{#${p.value}#}}`

      return `{{#${(p.value as ValueSelector).join('.')}#}}`
    }

    return p.value as string
  }))
  const [inputVarValues, doSetInputVarValues] = useState<Record<string, any>>({})
  const setInputVarValues = useCallback((value: Record<string, any>) => {
    doSetInputVarValues(value)
    setRunInputData(value)
  }, [setRunInputData])

  const inputVarValuesWithConstantValue = useCallback(() => {
    const res = produce(inputVarValues, (draft) => {
      Object.keys(inputs.tool_parameters).forEach((key: string) => {
        const { type, value } = inputs.tool_parameters[key]
        if (type === VarType.constant && (value === undefined || value === null)) {
            if(!draft.tool_parameters || !draft.tool_parameters[key])
            return
          draft[key] = value
        }
      })
    })
    return res
  }, [inputs.tool_parameters, inputVarValues])

  const forms = useMemo(() => {
    const forms: FormProps[] = [{
      inputs: varInputs,
      values: inputVarValuesWithConstantValue(),
      onChange: setInputVarValues,
    }]
    return forms
  }, [inputVarValuesWithConstantValue, setInputVarValues, varInputs])

  const nodeInfo = useMemo(() => {
    if (!runResult)
      return null
    return formatToTracingNodeList([runResult], t)[0]
  }, [runResult, t])

  const toolIcon = useToolIcon(payload)

  const getDependentVars = () => {
    return varInputs.map(item => item.variable.slice(1, -1).split('.'))
  }

  return {
    forms,
    nodeInfo,
    toolIcon,
    getDependentVars,
  }
}

export default useSingleRunFormParams
