import { BlockEnum, VarType } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray } from '../../utils/workflow'
import { comparisonOperatorNotRequireValue } from '../if-else/utils'
import { type ListFilterNodeType, OrderBy } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<ListFilterNodeType> = {
  defaultValue: {
    variable: [],
    filter_by: {
      enabled: false,
      conditions: [],
    },
    extract_by: {
      enabled: false,
      serial: '1',
    },
    order_by: {
      enabled: false,
      key: '',
      value: OrderBy.ASC,
    },
    limit: {
      enabled: false,
      size: 10,
    },
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
  checkValid(payload: ListFilterNodeType, t: any) {
    let errorMessages = ''
    const { variable, var_type, filter_by } = payload

    if (!errorMessages && !variable?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.inputVar') })

    // Check filter condition
    if (!errorMessages && filter_by?.enabled) {
      if (var_type === VarType.arrayFile && !filter_by.conditions[0]?.key)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.filterConditionKey') })

      if (!errorMessages && !filter_by.conditions[0]?.comparison_operator)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.filterConditionComparisonOperator') })

      if (!errorMessages && !comparisonOperatorNotRequireValue(filter_by.conditions[0]?.comparison_operator) && !filter_by.conditions[0]?.value)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.listFilter.filterConditionComparisonValue') })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: ListFilterNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr = []

    const variable_warnings = getNotExistVariablesByArray([payload.variable], varMap)
    if (variable_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.listFilter.inputVar')} ${t('workflow.common.referenceVar')}${variable_warnings.join('、')}${t('workflow.common.noExist')}`)
    return {
      isValid: true,
      warning_vars: variable_warnings,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
