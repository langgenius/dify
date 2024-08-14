import { BlockEnum, type NodeDefault } from '../../types'
import { type IfElseNodeType, LogicalOperator } from './types'
import { isEmptyRelatedOperator } from './utils'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
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
        if (!errorMessages && !isEmptyRelatedOperator(condition.comparison_operator!) && !condition.value)
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
      })
    })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
