import { BlockEnum, type NodeDefault } from '../../types'
import { type IfElseNodeType, LogicalOperator } from './types'
import { isEmptyRelatedOperator } from './utils'
import { TransferMethod } from '@/types/app'
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
}

export default nodeDefault

export const FILE_TYPE_OPTIONS = [
  { value: 'image', i18nKey: 'image' },
  { value: 'document', i18nKey: 'doc' },
  { value: 'audio', i18nKey: 'audio' },
  { value: 'video', i18nKey: 'video' },
]

export const TRANSFER_METHOD = [
  { value: TransferMethod.local_file, i18nKey: 'localUpload' },
  { value: TransferMethod.remote_url, i18nKey: 'url' },
]

export const SUB_VARIABLES = ['type', 'size', 'name', 'url', 'extension', 'mime_type', 'transfer_method']
export const OUTPUT_FILE_SUB_VARIABLES = SUB_VARIABLES.filter(key => key !== 'transfer_method')
