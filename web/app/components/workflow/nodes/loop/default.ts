import type { NodeDefault } from '../../types'
import type { LoopNodeType } from './types'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { LOOP_NODE_MAX_COUNT } from '@/config'
import { TransferMethod } from '@/types/app'
import { VarType } from '../../types'
import { ComparisonOperator, LogicalOperator } from './types'
import { isEmptyRelatedOperator } from './utils'

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Logic,
  sort: 3,
  type: BlockEnum.Loop,
  author: 'AICT-Team',
  isTypeFixed: true,
})
const nodeDefault: NodeDefault<LoopNodeType> = {
  metaData,
  defaultValue: {
    start_node_id: '',
    break_conditions: [],
    loop_count: 10,
    _children: [],
    logical_operator: LogicalOperator.and,
  },
  checkValid(payload: LoopNodeType, t: any) {
    let errorMessages = ''

    payload.loop_variables?.forEach((variable) => {
      if (!variable.label)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variable`, { ns: 'workflow' }) })
    })

    payload.break_conditions!.forEach((condition) => {
      if (!errorMessages && (!condition.variable_selector || condition.variable_selector.length === 0))
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variable`, { ns: 'workflow' }) })
      if (!errorMessages && !condition.comparison_operator)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.ifElse.operator', { ns: 'workflow' }) })
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
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variableValue`, { ns: 'workflow' }) })
        }
        else {
          if (!isEmptyRelatedOperator(condition.comparison_operator!) && (condition.varType === VarType.boolean ? condition.value === undefined : !condition.value))
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variableValue`, { ns: 'workflow' }) })
        }
      }
    })

    if (!errorMessages && (
      Number.isNaN(Number(payload.loop_count))
      || !Number.isInteger(Number(payload.loop_count))
      || payload.loop_count < 1
      || payload.loop_count > LOOP_NODE_MAX_COUNT
    )) {
      errorMessages = t('nodes.loop.loopMaxCountError', { ns: 'workflow', maxCount: LOOP_NODE_MAX_COUNT })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

type OptionItem = {
  value: string
  i18nKey: I18nKeysByPrefix<'workflow', 'nodes.ifElse.optionName.'>
}

export const FILE_TYPE_OPTIONS = [
  { value: 'image', i18nKey: 'image' },
  { value: 'document', i18nKey: 'doc' },
  { value: 'audio', i18nKey: 'audio' },
  { value: 'video', i18nKey: 'video' },
] as const satisfies readonly OptionItem[]

export const TRANSFER_METHOD = [
  { value: TransferMethod.local_file, i18nKey: 'localUpload' },
  { value: TransferMethod.remote_url, i18nKey: 'url' },
] as const satisfies readonly OptionItem[]

export const SUB_VARIABLES = ['type', 'size', 'name', 'url', 'extension', 'mime_type', 'transfer_method', 'related_id']
export const OUTPUT_FILE_SUB_VARIABLES = SUB_VARIABLES.filter(key => key !== 'transfer_method')

export default nodeDefault
