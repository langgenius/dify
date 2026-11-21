import type { RefObject } from 'react'
import type { Condition } from '../if-else/types'
import type { DecisionNodeType, RuleGroup } from './types'
import type { InputVar, ValueSelector, Variable } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { getInputVars as getTemplateSelectors } from '@/app/components/base/prompt-editor/constants'
import { DecideBy } from './types'

type Params = {
  id: string
  payload: DecisionNodeType
  runInputData: Record<string, unknown>
  runInputDataRef: RefObject<Record<string, unknown>>
  getInputVars: (textList: string[]) => InputVar[]
  setRunInputData: (data: Record<string, unknown>) => void
  toVarInputs: (variables: Variable[]) => InputVar[]
  varSelectorsToVarInputs: (variables: ValueSelector[]) => InputVar[]
}
const useSingleRunFormParams = ({
  payload,
  runInputData,
  setRunInputData,
  getInputVars,
  toVarInputs,
  varSelectorsToVarInputs,
}: Params) => {
  const setInputVarValues = useCallback(
    (newPayload: Record<string, unknown>) => {
      setRunInputData(newPayload)
    },
    [setRunInputData],
  )
  const inputVarValues = (() => {
    const vars: Record<string, unknown> = {}
    Object.keys(runInputData).forEach((key) => {
      vars[key] = runInputData[key]
    })
    return vars
  })()

  const getVarSelectorsFromCondition = (condition: Condition): ValueSelector[] => {
    const vars: ValueSelector[] = []
    if (condition.variable_selector) vars.push(condition.variable_selector)

    if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
      // oxlint-disable-next-line typescript/no-use-before-define -- the two helpers recurse into each other
      vars.push(...getVarSelectorsFromRuleGroup(condition.sub_variable_condition))

    return vars
  }

  const getVarSelectorsFromRuleGroup = (ruleGroup: RuleGroup): ValueSelector[] => {
    const vars: ValueSelector[] = []
    ruleGroup.conditions?.forEach((condition) => {
      vars.push(...getVarSelectorsFromCondition(condition))
    })
    return vars
  }

  // Template text a condition value carries; the backend resolves
  // `{{#node.var#}}` references in it before comparing.
  const getTemplatesFromRuleGroup = (ruleGroup: RuleGroup): string[] => {
    const templates: string[] = []
    ruleGroup.conditions?.forEach((condition) => {
      if (condition.value && typeof condition.value === 'string') templates.push(condition.value)

      if (condition.sub_variable_condition && condition.sub_variable_condition.conditions?.length)
        templates.push(...getTemplatesFromRuleGroup(condition.sub_variable_condition))
    })
    return templates
  }

  // Every template the current mode reads, as the backend extracts them for
  // single-step debugging: rule values in `rules` mode; outcome descriptions,
  // the glossary and the prompt in `llm` mode.
  const templates = (() => {
    if (payload.decide_by === DecideBy.llm)
      return [
        ...(payload.outcomes ?? []).flatMap((outcome) =>
          typeof outcome.when === 'string' ? [outcome.when] : [],
        ),
        payload.context?.glossary ?? '',
        payload.context?.prompt ?? '',
      ]

    return (payload.outcomes ?? []).flatMap((outcome) =>
      typeof outcome.when === 'object' && outcome.when !== null
        ? getTemplatesFromRuleGroup(outcome.when)
        : [],
    )
  })()

  const getRuleSelectors = () => {
    const vars: ValueSelector[] = []
    payload.outcomes?.forEach((outcome) => {
      if (typeof outcome.when === 'object' && outcome.when !== null)
        vars.push(...getVarSelectorsFromRuleGroup(outcome.when))
    })
    return vars
  }

  const forms = (() => {
    const varInputs: InputVar[] = [
      ...(payload.decide_by === DecideBy.llm
        ? toVarInputs(payload.inputs || [])
        : varSelectorsToVarInputs(getRuleSelectors())),
      ...getInputVars(templates),
    ]

    // remove duplicate inputs
    const existVarsKey: Record<string, boolean> = {}
    const uniqueVarInputs: InputVar[] = []
    varInputs.forEach((input) => {
      if (!input) return
      if (!existVarsKey[input.variable]) {
        existVarsKey[input.variable] = true
        uniqueVarInputs.push(input)
      }
    })

    return [
      {
        inputs: uniqueVarInputs,
        values: inputVarValues,
        onChange: setInputVarValues,
      },
    ]
  })()

  const getDependentVars = () => {
    const templateSelectors = templates.flatMap((template) => getTemplateSelectors(template))
    if (payload.decide_by === DecideBy.llm)
      return [
        ...(payload.inputs || []).map((variable) => variable.value_selector),
        ...templateSelectors,
      ]

    return [...getRuleSelectors(), ...templateSelectors]
  }

  const getDependentVar = (variable: string) => {
    if (payload.decide_by === DecideBy.llm) {
      const varItem = (payload.inputs || []).find((item) => item.variable === variable)
      if (varItem) return varItem.value_selector
    }

    return false
  }

  return {
    forms,
    getDependentVars,
    getDependentVar,
  }
}

export default useSingleRunFormParams
