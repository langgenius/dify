import type { TFunction } from 'i18next'
import type { NodeDefault } from '../../types'
import type { Condition } from '../if-else/types'
import type { DecisionNodeType, Outcome } from './types'
import { BlockClassification } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { VarType } from '../../types'
import { isEmptyRelatedOperator } from '../if-else/utils'
import { DecideBy, genDefaultRuleGroup, genOutcomeId, OTHERWISE_HANDLE_ID } from './types'
import { hasExtraNameError } from './utils'

const i18nPrefix = 'nodes.decision'

const metaData = genNodeMetaData({
  classification: BlockClassification.Logic,
  sort: 1,
  type: BlockEnum.Decision,
})

// Mirrors the If-Else completeness check in nodes/if-else/default.ts checkValid:
// a condition is complete when it has a variable, an operator, and (unless the
// operator is value-less) a value. Sub-variable conditions recurse the same way.
const checkConditionComplete = (condition: Condition): boolean => {
  if (!condition.variable_selector || condition.variable_selector.length === 0) return false
  if (!condition.comparison_operator) return false

  if (condition.sub_variable_condition) {
    return condition.sub_variable_condition.conditions.every((c) => {
      if (!c.comparison_operator) return false

      if (isEmptyRelatedOperator(c.comparison_operator!)) return true

      return c.varType === VarType.boolean || c.varType === VarType.arrayBoolean
        ? c.value === undefined
        : !!c.value
    })
  }

  if (isEmptyRelatedOperator(condition.comparison_operator!)) return true

  return condition.varType === VarType.boolean || condition.varType === VarType.arrayBoolean
    ? condition.value !== undefined
    : !!condition.value
}

export const checkOutcomeRulesComplete = (outcome: Outcome): boolean => {
  const when = outcome.when
  if (typeof when !== 'object' || when === null) return false

  return when.conditions.length > 0 && when.conditions.every(checkConditionComplete)
}

const nodeDefault: NodeDefault<DecisionNodeType> = {
  metaData,
  defaultValue: (() => {
    const defaultOutcomeId = genOutcomeId()

    return {
      intent: '',
      decide_by: DecideBy.rules,
      outcomes: [
        {
          id: defaultOutcomeId,
          label: '',
          when: genDefaultRuleGroup(),
        },
      ],
      otherwise: {
        label: '',
      },
      inputs: [],
      context: {
        glossary: '',
        prompt: '',
      },
      extras: [],
      _targetBranches: [
        { id: defaultOutcomeId, name: '' },
        { id: OTHERWISE_HANDLE_ID, name: '' },
      ],
    }
  })(),
  checkValid(payload: DecisionNodeType, t: TFunction<['workflow']>) {
    let errorMessages = ''
    if (!payload.outcomes || payload.outcomes.length === 0)
      errorMessages = t(($) => $[`${i18nPrefix}.errorMsg.outcomeRequired`], { ns: 'workflow' })

    if (!errorMessages && payload.outcomes.some((outcome) => !outcome.label))
      errorMessages = t(($) => $[`${i18nPrefix}.errorMsg.outcomeLabelRequired`], { ns: 'workflow' })

    if (!errorMessages && payload.decide_by === DecideBy.rules) {
      if (!payload.outcomes.every(checkOutcomeRulesComplete))
        errorMessages = t(($) => $[`${i18nPrefix}.errorMsg.conditionRequired`], { ns: 'workflow' })
    }

    if (!errorMessages && payload.decide_by === DecideBy.llm) {
      if (!payload.model?.provider)
        errorMessages = t(($) => $[`${i18nPrefix}.errorMsg.modelRequired`], { ns: 'workflow' })

      if (!errorMessages && payload.outcomes.some((outcome) => !outcome.when))
        errorMessages = t(($) => $[`${i18nPrefix}.errorMsg.whenRequired`], { ns: 'workflow' })

      if (!errorMessages && (!payload.inputs || payload.inputs.length === 0))
        errorMessages = t(($) => $[`${i18nPrefix}.errorMsg.inputRequired`], { ns: 'workflow' })
    }

    if (!errorMessages && hasExtraNameError(payload.extras))
      errorMessages = t(($) => $[`${i18nPrefix}.errorMsg.extraNameInvalid`], { ns: 'workflow' })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
