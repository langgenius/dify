import { BlockEnum } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByText } from '../../utils/workflow'
import type { AnswerNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

const nodeDefault: NodeDefault<AnswerNodeType> = {
  defaultValue: {
    variables: [],
    answer: '',
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: AnswerNodeType, t: any) {
    let errorMessages = ''
    const { answer } = payload
    if (!answer)
      errorMessages = t('workflow.errorMsg.fieldRequired', { field: t('workflow.nodes.answer.answer') })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: AnswerNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr = []

    const answer_warnings = getNotExistVariablesByText(payload.answer || '', varMap)
    if (answer_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.answer.answer')} ${t('workflow.common.referenceVar')}${answer_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: [...answer_warnings],
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
