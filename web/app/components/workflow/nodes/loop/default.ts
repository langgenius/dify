import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { ComparisonOperator, LogicalOperator, type LoopNodeType } from './types'
import { isEmptyRelatedOperator } from './utils'
import { TransferMethod } from '@/types/app'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
import { LOOP_NODE_MAX_COUNT } from '@/config'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<LoopNodeType> = {
  defaultValue: {
    start_node_id: '',
    break_conditions: [],
    loop_count: 10,
    _children: [],
    logical_operator: LogicalOperator.and,
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
  checkValid(payload: LoopNodeType, t: any) {
    let errorMessages = ''

    if (!errorMessages && (!payload.break_conditions || payload.break_conditions.length === 0))
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.loop.breakCondition') })

    payload.break_conditions!.forEach((condition) => {
      if (!errorMessages && (!condition.variable_selector || condition.variable_selector.length === 0))
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
      if (!errorMessages && !condition.comparison_operator)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.ifElse.operator') })
      if (!errorMessages) {
        if (condition.sub_variable_condition
          && ![ComparisonOperator.empty, ComparisonOperator.notEmpty].includes(condition.comparison_operator!)) {
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

    if (!errorMessages && (
      Number.isNaN(Number(payload.loop_count))
      || !Number.isInteger(Number(payload.loop_count))
      || payload.loop_count < 1
      || payload.loop_count > LOOP_NODE_MAX_COUNT
    ))
      errorMessages = t('workflow.nodes.loop.loopMaxCountError', { maxCount: LOOP_NODE_MAX_COUNT })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

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

export default nodeDefault
