import { BlockEnum, ErrorHandleMode } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray } from '../../utils/workflow'
import type { IterationNodeType } from './types'
import {
  ALL_CHAT_AVAILABLE_BLOCKS,
  ALL_COMPLETION_AVAILABLE_BLOCKS,
} from '@/app/components/workflow/blocks'
const i18nPrefix = 'workflow'

const nodeDefault: NodeDefault<IterationNodeType> = {
  defaultValue: {
    start_node_id: '',
    iterator_selector: [],
    output_selector: [],
    _children: [],
    _isShowTips: false,
    is_parallel: false,
    parallel_nums: 10,
    error_handle_mode: ErrorHandleMode.Terminated,
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(
        type => type !== BlockEnum.End,
      )
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: IterationNodeType, t: any) {
    let errorMessages = ''

    if (
      !errorMessages
      && (!payload.iterator_selector || payload.iterator_selector.length === 0)
    ) {
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, {
        field: t(`${i18nPrefix}.nodes.iteration.input`),
      })
    }

    if (
      !errorMessages
      && (!payload.output_selector || payload.output_selector.length === 0)
    ) {
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, {
        field: t(`${i18nPrefix}.nodes.iteration.output`),
      })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: IterationNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr: string[] = []

    const iterator_selector_warnings = getNotExistVariablesByArray([payload.iterator_selector], varMap)
    if (iterator_selector_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.iteration.input')} ${t('workflow.common.referenceVar')}${iterator_selector_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: iterator_selector_warnings,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
