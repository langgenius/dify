import type { NodeDefault } from '../../types'
import type { AnswerNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const metaData = genNodeMetaData({
  sort: 2.1,
  type: BlockEnum.Answer,
  isRequired: true,
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
}

export default nodeDefault
