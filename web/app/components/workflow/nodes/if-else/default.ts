import type { Var } from '../../types'
import { BlockEnum, type NodeDefault } from '../../types'
import { getNotExistVariablesByArray, getNotExistVariablesByText } from '../../utils/workflow'
import { type IfElseNodeType, LogicalOperator } from './types'
import { isEmptyRelatedOperator } from './utils'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<IfElseNodeType> = {
  defaultValue: {
    _targetBranches: [
      {
        id: 'true',
        name: 'IF',
      },
      {
        id: 'false',
        name: 'ELSE',
      },
    ],
    cases: [
      {
        case_id: 'true',
        logical_operator: LogicalOperator.and,
        conditions: [],
      },
    ],
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: IfElseNodeType, t: any) {
    let errorMessages = ''
    const { cases } = payload
    if (!cases || cases.length === 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: 'IF' })

    cases.forEach((caseItem, index) => {
      if (!caseItem.conditions.length)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: index === 0 ? 'IF' : 'ELIF' })

      caseItem.conditions.forEach((condition) => {
        if (!errorMessages && (!condition.variable_selector || condition.variable_selector.length === 0))
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
        if (!errorMessages && !condition.comparison_operator)
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.ifElse.operator') })
        if (!errorMessages) {
          if (condition.sub_variable_condition) {
            const isSet = condition.sub_variable_condition.conditions.every((c) => {
              if (!c.comparison_operator)
                return false

              if (isEmptyRelatedOperator(c.comparison_operator!))
                return true

              return !!c.value
            })
            if (!isSet)
              errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
          }
          else {
            if (!isEmptyRelatedOperator(condition.comparison_operator!) && !condition.value)
              errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
          }
        }
      })
    })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: IfElseNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr = []

    const condition_variable_selector_warnings: string[] = []
    const condition_value_warnings: string[] = []
    payload.cases.forEach((caseItem) => {
      caseItem.conditions.forEach((condition) => {
        if (!condition.variable_selector)
          return
        const selector_warnings = getNotExistVariablesByArray([condition.variable_selector], varMap)
        if (selector_warnings.length)
          condition_variable_selector_warnings.push(...selector_warnings)
        const value_warnings = Array.isArray(condition.value) ? getNotExistVariablesByArray([condition.value], varMap) : getNotExistVariablesByText(condition.value, varMap)
        if (value_warnings.length)
          condition_value_warnings.push(...value_warnings)
        condition.sub_variable_condition?.conditions.forEach((subCondition) => {
          const sub_variable_value_warnings = Array.isArray(subCondition.value) ? getNotExistVariablesByArray([subCondition.value], varMap) : getNotExistVariablesByText(subCondition.value, varMap)
          if (sub_variable_value_warnings.length)
            condition_value_warnings.push(...sub_variable_value_warnings)
        })
      })
    })

    if (condition_variable_selector_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.ifElse.condition')} ${t('workflow.common.referenceVar')}${condition_variable_selector_warnings.join('、')}${t('workflow.common.noExist')}`)

    if (condition_value_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.ifElse.enterValue')} ${t('workflow.common.referenceVar')}${condition_value_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: condition_variable_selector_warnings,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
