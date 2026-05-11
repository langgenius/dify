import type { NodeDefault } from '../../types'
import type { IfElseNodeType } from './types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { VarType } from '../../types'
import { LogicalOperator } from './types'
import { isEmptyRelatedOperator } from './utils'

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Logic,
  sort: 1,
  type: BlockEnum.IfElse,
  helpLinkUri: 'ifelse',
})
const nodeDefault: NodeDefault<IfElseNodeType> = {
  metaData,
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
  checkValid(payload: IfElseNodeType, t: any) {
    let errorMessages = ''
    const { cases } = payload
    if (!cases || cases.length === 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: 'IF' })

    cases.forEach((caseItem, index) => {
      if (!caseItem.conditions.length)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: index === 0 ? 'IF' : 'ELIF' })

      caseItem.conditions.forEach((condition) => {
        if (!errorMessages && (!condition.variable_selector || condition.variable_selector.length === 0))
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variable`, { ns: 'workflow' }) })
        if (!errorMessages && !condition.comparison_operator)
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.ifElse.operator', { ns: 'workflow' }) })
        if (!errorMessages) {
          if (condition.sub_variable_condition) {
            const isSet = condition.sub_variable_condition.conditions.every((c) => {
              if (!c.comparison_operator)
                return false

              if (isEmptyRelatedOperator(c.comparison_operator!))
                return true

              return (c.varType === VarType.boolean || c.varType === VarType.arrayBoolean) ? c.value === undefined : !!c.value
            })
            if (!isSet)
              errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variableValue`, { ns: 'workflow' }) })
          }
          else {
            if (!isEmptyRelatedOperator(condition.comparison_operator!) && ((condition.varType === VarType.boolean || condition.varType === VarType.arrayBoolean) ? condition.value === undefined : !condition.value))
              errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variableValue`, { ns: 'workflow' }) })
          }
        }
      })
    })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
