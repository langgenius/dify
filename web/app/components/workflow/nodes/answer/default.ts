import type { NodeDefault } from '../../types'
import type { AnswerNodeType } from './types'
import { BlockEnum } from '@/app/components/workflow/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'

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
      errorMessages = t('errorMsg.fieldRequired', { ns: 'workflow', field: t('nodes.answer.answer', { ns: 'workflow' }) })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
