import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByText } from '../../utils/workflow'
import type { AnswerNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const metaData = genNodeMetaData({
  sort: 2.1,
  type: BlockEnum.Answer,
})
const nodeDefault: NodeDefault<AnswerNodeType> = {
  metaData,
  defaultValue: {
    variables: [],
    answer: '',
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
