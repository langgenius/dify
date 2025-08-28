import { type NodeDefault, VarType } from '../../types'
import { type IfElseNodeType, LogicalOperator } from './types'
import { isEmptyRelatedOperator } from './utils'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
const i18nPrefix = 'workflow.errorMsg'

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

              return (c.varType === VarType.boolean || c.varType === VarType.arrayBoolean) ? c.value === undefined : !!c.value
            })
            if (!isSet)
              errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
          }
          else {
            if (!isEmptyRelatedOperator(condition.comparison_operator!) && ((condition.varType === VarType.boolean || condition.varType === VarType.arrayBoolean) ? condition.value === undefined : !condition.value))
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
}

export default nodeDefault
