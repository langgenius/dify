import type { RefObject } from 'react'
import type { ToolNodeType } from './types'
import type { Props as FormProps } from '@/app/components/workflow/nodes/_base/components/before-run-form/form'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import formatToTracingNodeList from '@/app/components/workflow/run/utils/format-log'
import { AGENT_CONTEXT_VAR_PATTERN } from '@/app/components/workflow/utils/agent-context'
import { useToolIcon } from '../../hooks'
import useNodeCrud from '../_base/hooks/use-node-crud'
import { VarType } from './types'

type Params = {
  id: string
  payload: ToolNodeType
  runInputData: Record<string, any>
  runInputDataRef: RefObject<Record<string, any>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, any>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  runResult: NodeTracing
}
type NestedNodeParam = {
  type?: VarType
  value?: unknown
  nested_node_config?: {
    extractor_node_id?: string
    output_selector?: unknown
  }
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
    .filter(key => ![VarType.constant, VarType.nested_node].includes(inputs.tool_parameters[key].type))
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
          if (!draft.tool_parameters || !draft.tool_parameters[key])
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

  const resolveOutputSelector = (extractorNodeId: string, rawSelector?: unknown) => {
    if (!Array.isArray(rawSelector))
      return [] as string[]
    if (rawSelector[0] === extractorNodeId)
      return rawSelector.slice(1) as string[]
    return rawSelector as string[]
  }

  const getDefaultNestedOutputSelector = (paramKey: string, value?: unknown) => {
    if (typeof value === 'string') {
      const matches = Array.from(value.matchAll(AGENT_CONTEXT_VAR_PATTERN))
      if (matches.length > 0)
        return ['structured_output', paramKey]
    }
    return ['result']
  }

  const collectNestedNodeSelectors = (params: Record<string, NestedNodeParam> = {}) => {
    return Object.entries(params).flatMap(([paramKey, param]) => {
      if (!param || param.type !== VarType.nested_node)
        return [] as ValueSelector[]

      const nestedConfig = param.nested_node_config
      const extractorNodeId = nestedConfig?.extractor_node_id || `${id}_ext_${paramKey}`
      const rawSelector = nestedConfig?.output_selector
      const resolvedOutputSelector = resolveOutputSelector(extractorNodeId, rawSelector)
      const outputSelector = resolvedOutputSelector.length > 0
        ? resolvedOutputSelector
        : getDefaultNestedOutputSelector(paramKey, param.value)

      return outputSelector.length > 0
        ? [[extractorNodeId, ...outputSelector]]
        : []
    })
  }

  const getDependentVars = () => {
    const selectorList: ValueSelector[] = []

    varInputs.forEach((item) => {
      // Guard against null/undefined variable to prevent app crash
      if (!item.variable || typeof item.variable !== 'string')
        return
      const selector = item.variable.slice(1, -1).split('.')
      if (selector.length > 0)
        selectorList.push(selector)
    })

    const nestedSelectors = [
      ...collectNestedNodeSelectors(inputs.tool_parameters as Record<string, NestedNodeParam>),
      ...collectNestedNodeSelectors(inputs.tool_configurations as Record<string, NestedNodeParam>),
    ]
    selectorList.push(...nestedSelectors)

    const seen = new Set<string>()
    return selectorList.filter((selector) => {
      const key = selector.join('.')
      if (seen.has(key))
        return false
      seen.add(key)
      return true
    })
  }

  return {
    forms,
    nodeInfo,
    toolIcon,
    getDependentVars,
  }
}

export default useSingleRunFormParams
