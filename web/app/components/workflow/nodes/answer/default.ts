import { BlockEnum, type NodeDefault } from '../../types'
import type { AnswerNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const nodeDefault: NodeDefault<AnswerNodeType> = {
  defaultValue: {
    variables: [],
    answer: '',
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.Answer)
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes() {
    return []
  },
  checkValid(payload: AnswerNodeType) {
    let isValid = true
    let errorMessages = ''
    if (payload.type) {
      isValid = true
      errorMessages = ''
    }
    return {
      isValid,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
